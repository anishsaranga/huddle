/**
 * Recomputing and storing `daily_scores`.
 *
 * `recomputeUser` loads the user's inputs once (baseline.ts), computes every
 * date in [from, to] in order, and writes the result in ONE transaction:
 * dates with any input get a row (scores may be null; `components` then says
 * why, e.g. `calibrating`), dates without any input lose their row. A
 * per-user advisory lock serializes concurrent recomputes (two syncs in a
 * row). Scores are derived only from raw data, so running it twice gives the
 * same rows.
 */

import { and, between, eq, notInArray, sql } from "drizzle-orm";
import { dailyScores } from "@/db/schema";
import type { Db } from "@/lib/admin/db";
import { addDays, todayIn } from "@/lib/tz";
import { loadScoreInputs, loadScoreUser } from "@/lib/scores/baseline";
import { computeDay, createContext, hasInputs, toScoreRow } from "@/lib/scores/compute";
import { BASELINE_DAYS, CONSISTENCY_NIGHTS, type ScoreUser } from "@/lib/scores/types";

/**
 * How far past the last changed date scores can change: recovery on D uses
 * the 30 days before it, and the sleep scores in that window use the 7 nights
 * before them (consistency), so a change on X reaches X+37.
 */
export const FORWARD_DAYS = BASELINE_DAYS + CONSISTENCY_NIGHTS;

const ROWS_PER_STATEMENT = 1000;
const excluded = (column: string) => sql.raw(`excluded."${column}"`);

export type RecomputeOptions = {
  /** Skip the user lookup when the caller already has it. */
  user?: ScoreUser;
};

/**
 * Recompute and store scores for `from..to` (inclusive local dates). Returns
 * the number of `daily_scores` rows written (0 for an unknown user).
 */
export async function recomputeUser(db: Db, userId: string, from: string, to: string, opts: RecomputeOptions = {}): Promise<number> {
  if (from > to) return 0;
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`scores:${userId}`}))`);
    const user = opts.user ?? (await loadScoreUser(tx, userId));
    if (!user) return 0;
    const ctx = createContext(await loadScoreInputs(tx, user, from, to));

    const rows = [];
    for (let date = from; date <= to; date = addDays(date, 1)) {
      if (!hasInputs(ctx, date)) continue;
      rows.push({ userId, localDate: date, ...toScoreRow(computeDay(ctx, date)), computedAt: new Date() });
    }

    const inRange = and(eq(dailyScores.userId, userId), between(dailyScores.localDate, from, to));
    await tx
      .delete(dailyScores)
      .where(rows.length ? and(inRange, notInArray(dailyScores.localDate, rows.map((r) => r.localDate))) : inRange);
    for (let i = 0; i < rows.length; i += ROWS_PER_STATEMENT) {
      await tx
        .insert(dailyScores)
        .values(rows.slice(i, i + ROWS_PER_STATEMENT))
        .onConflictDoUpdate({
          target: [dailyScores.userId, dailyScores.localDate],
          set: {
            sleepScore: excluded("sleep_score"),
            recovery: excluded("recovery"),
            strain: excluded("strain"),
            components: excluded("components"),
            computedAt: excluded("computed_at"),
          },
        });
    }
    return rows.length;
  });
}

/**
 * The date range an ingest invalidates: from the earliest changed date to
 * FORWARD_DAYS past the latest one, but never beyond tomorrow (in the user's
 * timezone; ingest accepts dates up to today + 1).
 */
export function ingestRecomputeRange(affectedDates: readonly string[], tz: string, now: Date = new Date()): { from: string; to: string } | null {
  if (affectedDates.length === 0) return null;
  const sorted = [...affectedDates].sort();
  const from = sorted[0];
  const last = sorted[sorted.length - 1];
  const tomorrow = addDays(todayIn(tz, now), 1);
  const forward = addDays(last, FORWARD_DAYS);
  const to = forward < tomorrow ? forward : tomorrow;
  return { from, to: to < last ? last : to };
}

/** What the ingest hook runs. Returns the rows written. */
export async function recomputeAfterIngest(db: Db, userId: string, affectedDates: readonly string[], now: Date = new Date()): Promise<number> {
  if (affectedDates.length === 0) return 0;
  const user = await loadScoreUser(db, userId);
  if (!user) return 0;
  const range = ingestRecomputeRange(affectedDates, user.timezone, now);
  if (!range) return 0;
  return recomputeUser(db, userId, range.from, range.to, { user });
}
