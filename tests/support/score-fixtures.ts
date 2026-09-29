/**
 * Score-engine fixtures: hand-built nights, and whole ScoreInputs produced by
 * the demo-data generator run through the real ingest parse + normalize
 * (exactly what would land in the tables, minus the DB).
 */

import type { MetricName } from "@/lib/health/fields";
import { normalizeIngest } from "@/lib/ingest/normalize";
import { parsePayload } from "@/lib/ingest/schema";
import type { DayMetrics, HourRow, NightRow, ScoreInputs, ScoreUser } from "@/lib/scores/types";
import { addDays, zonedTimeToUtc } from "@/lib/tz";
import { buildPayload, DEMO_USERS, type ProfileId } from "../../scripts/seed/generate";

/** Instant of local wall time `hh:mm` on `date` in `tz` (hour may be negative: the evening before). */
export function at(date: string, hhmm: string, tz: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  const day = h < 0 ? addDays(date, -1) : date;
  const hour = h < 0 ? 24 + h : h;
  const [y, mo, d] = day.split("-").map(Number);
  return zonedTimeToUtc(y, mo, d, hour, m, 0, 0, tz);
}

export type NightOpts = Partial<Omit<NightRow, "bedStart" | "bedEnd">> & {
  /** Local bedtime on the evening before (e.g. "23:10") or after midnight ("00:30"). */
  bed?: string;
  /** Local wake time on the wake date. */
  wake?: string;
  tz?: string;
};

/** A night ending on `wakeDate` (defaults: Apple Watch-like, 23:00 -> 07:00, 450 asleep, staged). */
export function night(wakeDate: string, o: NightOpts = {}): NightRow {
  const tz = o.tz ?? "Europe/Berlin";
  const bed = o.bed ?? "23:00";
  const bh = Number(bed.split(":")[0]);
  const bedStart = bh >= 12 ? at(addDays(wakeDate, -1), bed, tz) : at(wakeDate, bed, tz);
  const bedEnd = at(wakeDate, o.wake ?? "07:00", tz);
  return {
    wakeDate,
    chosenSource: o.chosenSource ?? "Apple Watch",
    bedStart,
    bedEnd,
    inBedMin: o.inBedMin ?? (bedEnd - bedStart) / 60_000,
    asleepMin: o.asleepMin === undefined ? 450 : o.asleepMin,
    awakeMin: o.awakeMin ?? 30,
    coreMin: o.coreMin ?? 270,
    deepMin: o.deepMin ?? 75,
    remMin: o.remMin ?? 105,
    hasStages: o.hasStages ?? true,
    inBedMeasured: o.inBedMeasured ?? true,
  };
}

const METRIC_KEYS = ["resting_hr", "hrv_sdnn_ms", "resp_rate", "active_kcal", "exercise_min", "steps"] as const;

/**
 * ScoreInputs for the demo user with `profile`, `from..to`, as ingest would
 * store them (sent in 30-day chunks, oldest first, like the seed backfill).
 */
export function demoInputs(profile: ProfileId, from: string, to: string, now: Date): ScoreInputs {
  const u = DEMO_USERS.find((d) => d.profile === profile)!;
  const user: ScoreUser = { id: u.slug, timezone: u.timezone, dob: u.dob, maxHr: u.maxHr, sleepGoalMin: u.sleepGoalMin };
  const metrics = new Map<string, DayMetrics>();
  const hr = new Map<string, HourRow[]>();
  const nights = new Map<string, NightRow>();
  for (let start = from; start <= to; start = addDays(start, 30)) {
    const end = addDays(start, 29) < to ? addDays(start, 29) : to;
    const parsed = parsePayload(buildPayload(u, { from: start, to: end, now }));
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues.slice(0, 3)));
    const n = normalizeIngest(parsed.payload, { profileTz: u.timezone, now });
    if (!n.ok) throw new Error(JSON.stringify(n.issues.slice(0, 3)));
    for (const d of n.value.days) {
      const prev = metrics.get(d.date);
      const row = Object.fromEntries(
        METRIC_KEYS.map((k) => [k, k in d.metrics ? (d.metrics[k as MetricName] ?? null) : (prev?.[k] ?? null)]),
      ) as DayMetrics;
      metrics.set(d.date, row);
      if (d.hrHourly) {
        if (d.hrHourly.length) hr.set(d.date, d.hrHourly.map((r) => ({ ...r })));
        else hr.delete(d.date);
      }
    }
    for (const x of n.value.nights) {
      const s = x.summary;
      nights.set(x.wakeDate, {
        wakeDate: x.wakeDate,
        chosenSource: s.chosenSource,
        bedStart: s.bedStart,
        bedEnd: s.bedEnd,
        inBedMin: s.inBedMin,
        asleepMin: s.asleepMin,
        awakeMin: s.awakeMin,
        coreMin: s.coreMin,
        deepMin: s.deepMin,
        remMin: s.remMin,
        hasStages: s.hasStages,
        inBedMeasured: x.segments.some((seg) => seg.stage === "in_bed"),
      });
    }
  }
  return { user, metrics, hr, nights };
}
