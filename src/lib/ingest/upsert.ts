/**
 * Storing a normalized ingest payload, in ONE transaction:
 *
 * - `daily_metrics`: INSERT ... ON CONFLICT (user_id, local_date) DO UPDATE
 *   of only the metric keys the day carried (explicit null clears, absent is
 *   untouched). Days are batched into one multi-row statement per distinct
 *   key set, so a 366-day backfill is a handful of statements.
 * - `hr_hourly`: days that sent hr_hourly get their rows replaced.
 * - Sleep: each night in the payload replaces the stored segments of its wake
 *   date (the Shortcut resends whole nights) and its `sleep_nights` row.
 *   Older segments on other wake dates that overlap the new sessions (e.g. a
 *   night first seen half-finished) are removed and those nights recomputed.
 */

import { and, eq, inArray, notInArray, sql, type SQL } from "drizzle-orm";
import { dailyMetrics, hrHourly, sleepNights, sleepSegments } from "@/db/schema";
import type { Db } from "@/lib/admin/db";
import { getMetricField, type MetricName } from "@/lib/health/fields";
import type { NormalizedDay, NormalizedIngest } from "@/lib/ingest/normalize";
import { summarizeNight, type NightSummary, type Segment } from "@/lib/ingest/sleep-merge";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type UpsertResult = {
  rowsInserted: number;
  rowsUpdated: number;
  hrRows: number;
  /** Wake dates written from this payload. */
  nightsWritten: string[];
  /** Other wake dates recomputed (or removed) because their segments were superseded. */
  nightsRecomputed: string[];
  /** Every local date whose stored data changed (sorted). */
  affectedDates: string[];
};

const METRIC_ROWS_PER_STATEMENT = 1000;

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const excluded = (column: string) => sql.raw(`excluded."${column}"`);

async function upsertDays(tx: Tx, userId: string, days: readonly NormalizedDay[]) {
  // Group by the exact set of metric keys, so each statement's SET list is fixed.
  const groups = new Map<string, NormalizedDay[]>();
  for (const d of days) {
    const sig = Object.keys(d.metrics).sort().join(",");
    const list = groups.get(sig);
    if (list) list.push(d);
    else groups.set(sig, [d]);
  }

  let inserted = 0;
  let updated = 0;
  for (const [sig, group] of groups) {
    const keys = (sig ? sig.split(",") : []) as MetricName[];
    const set: Record<string, SQL> = { updatedAt: sql`now()` };
    for (const k of keys) set[k] = excluded(getMetricField(k).column);
    for (const batch of chunks(group, METRIC_ROWS_PER_STATEMENT)) {
      const rows = await tx
        .insert(dailyMetrics)
        .values(batch.map((d) => ({ userId, localDate: d.date, ...d.metrics })))
        .onConflictDoUpdate({ target: [dailyMetrics.userId, dailyMetrics.localDate], set })
        .returning({ inserted: sql<boolean>`(xmax = 0)` });
      for (const r of rows) {
        if (r.inserted) inserted++;
        else updated++;
      }
    }
  }
  return { inserted, updated };
}

async function replaceHrHourly(tx: Tx, userId: string, days: readonly NormalizedDay[]): Promise<number> {
  const hrDays = days.filter((d) => d.hrHourly !== undefined);
  if (hrDays.length === 0) return 0;
  await tx
    .delete(hrHourly)
    .where(and(eq(hrHourly.userId, userId), inArray(hrHourly.localDate, hrDays.map((d) => d.date))));
  const rows = hrDays.flatMap((d) => d.hrHourly!.map((r) => ({ d: d.date, h: r.hour, a: r.avg, mi: r.min, ma: r.max })));
  if (rows.length === 0) return 0;
  // One JSON parameter instead of ~9k rows x 6 bind parameters: several times faster for backfills.
  await tx.execute(sql`
    insert into ${hrHourly} (user_id, local_date, hour, avg, min, max)
    select ${userId}::uuid, r.d, r.h, r.a, r.mi, r.ma
    from json_to_recordset(${JSON.stringify(rows)}::json) as r(d date, h smallint, a real, mi real, ma real)`);
  return rows.length;
}

function nightRow(userId: string, s: NightSummary) {
  return {
    userId,
    wakeDate: s.wakeDate,
    chosenSource: s.chosenSource,
    bedStart: new Date(s.bedStart),
    bedEnd: new Date(s.bedEnd),
    inBedMin: s.inBedMin,
    asleepMin: s.asleepMin,
    awakeMin: s.awakeMin,
    coreMin: s.coreMin,
    deepMin: s.deepMin,
    remMin: s.remMin,
    hasStages: s.hasStages,
  };
}

async function upsertNights(tx: Tx, userId: string, summaries: readonly NightSummary[]) {
  if (summaries.length === 0) return;
  await tx
    .insert(sleepNights)
    .values(summaries.map((s) => nightRow(userId, s)))
    .onConflictDoUpdate({
      target: [sleepNights.userId, sleepNights.wakeDate],
      set: {
        chosenSource: excluded("chosen_source"),
        bedStart: excluded("bed_start"),
        bedEnd: excluded("bed_end"),
        inBedMin: excluded("in_bed_min"),
        asleepMin: excluded("asleep_min"),
        awakeMin: excluded("awake_min"),
        coreMin: excluded("core_min"),
        deepMin: excluded("deep_min"),
        remMin: excluded("rem_min"),
        hasStages: excluded("has_stages"),
        updatedAt: sql`now()`,
      },
    });
}

async function replaceSleep(tx: Tx, userId: string, n: NormalizedIngest) {
  if (n.nights.length === 0) return { written: [] as string[], recomputed: [] as string[] };
  const wakeDates = n.nights.map((x) => x.wakeDate);
  const spans = n.nights.flatMap((x) => x.spans).filter((s) => s.end > s.start);

  // Segments stored under other wake dates that overlap the new sessions are superseded.
  let recomputed: string[] = [];
  if (spans.length) {
    const spansJson = JSON.stringify(spans.map((s) => ({ a: new Date(s.start).toISOString(), b: new Date(s.end).toISOString() })));
    const overlaps = sql`exists (
      select 1 from json_to_recordset(${spansJson}::json) as s(a timestamptz, b timestamptz)
      where ${sleepSegments.startTs} < s.b and ${sleepSegments.endTs} > s.a)`;
    const moved = await tx
      .delete(sleepSegments)
      .where(and(eq(sleepSegments.userId, userId), notInArray(sleepSegments.wakeDate, wakeDates), overlaps))
      .returning({ wakeDate: sleepSegments.wakeDate });
    recomputed = [...new Set(moved.map((m) => m.wakeDate))].sort();
  }

  await tx.delete(sleepSegments).where(and(eq(sleepSegments.userId, userId), inArray(sleepSegments.wakeDate, wakeDates)));
  const rows = n.nights.flatMap((night) =>
    night.segments.map((s) => ({
      w: night.wakeDate,
      st: s.stage,
      s: new Date(s.start).toISOString(),
      e: new Date(s.end).toISOString(),
      src: s.source,
    })),
  );
  await tx.execute(sql`
    insert into ${sleepSegments} (user_id, wake_date, stage, start_ts, end_ts, source)
    select ${userId}::uuid, r.w, r.st, r.s, r.e, r.src
    from json_to_recordset(${JSON.stringify(rows)}::json) as r(w date, st text, s timestamptz, e timestamptz, src text)`);
  await upsertNights(tx, userId, n.nights.map((x) => x.summary));

  if (recomputed.length) {
    const remaining = await tx
      .select()
      .from(sleepSegments)
      .where(and(eq(sleepSegments.userId, userId), inArray(sleepSegments.wakeDate, recomputed)));
    const byDate = new Map<string, Segment[]>();
    for (const r of remaining) {
      const seg: Segment = { stage: r.stage, start: r.startTs.getTime(), end: r.endTs.getTime(), source: r.source };
      const list = byDate.get(r.wakeDate);
      if (list) list.push(seg);
      else byDate.set(r.wakeDate, [seg]);
    }
    const empty = recomputed.filter((d) => !byDate.has(d));
    if (empty.length) {
      await tx.delete(sleepNights).where(and(eq(sleepNights.userId, userId), inArray(sleepNights.wakeDate, empty)));
    }
    // Keep the stored wake date even if the leftover segments would now end on another day.
    await upsertNights(
      tx,
      userId,
      [...byDate.entries()].map(([wakeDate, segs]) => ({ ...summarizeNight(segs, n.tz), wakeDate })),
    );
  }
  return { written: wakeDates, recomputed };
}

/** Store everything in one transaction. Throws (and rolls back) on any database error. */
export async function upsertIngest(db: Db, userId: string, n: NormalizedIngest): Promise<UpsertResult> {
  return db.transaction(async (tx) => {
    // Serialize concurrent syncs of the same user (sleep replace is delete + insert).
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`ingest:${userId}`}))`);
    const { inserted, updated } = await upsertDays(tx, userId, n.days);
    const hrRows = await replaceHrHourly(tx, userId, n.days);
    const sleep = await replaceSleep(tx, userId, n);
    const affected = new Set<string>([...n.days.map((d) => d.date), ...sleep.written, ...sleep.recomputed]);
    return {
      rowsInserted: inserted,
      rowsUpdated: updated,
      hrRows,
      nightsWritten: sleep.written,
      nightsRecomputed: sleep.recomputed,
      affectedDates: [...affected].sort(),
    };
  });
}
