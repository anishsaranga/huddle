/**
 * Personal baselines and the loader that fetches a user's score inputs.
 *
 * A baseline for date D is a robust mean + SD over D-30..D-1 (the day itself
 * is never part of its own baseline) and needs >= 4 valid values. "Robust":
 * values are winsorized (clipped) to the narrower of the 5th-95th percentile
 * range and median +/- 3 robust SDs (1.4826 x MAD), so one odd day (a
 * mis-sync, a fever) can't drag the mean or blow up the SD. The SD is then
 * floored at a metric-specific minimum so tiny natural variation doesn't turn
 * a 1 bpm change into a huge z-score.
 */

import { and, asc, between, eq } from "drizzle-orm";
import { dailyMetrics, hrHourly, sleepNights, sleepSegments, users } from "@/db/schema";
import type { Executor } from "@/lib/admin/db";
import { addDays } from "@/lib/tz";
import { isNum, median, quantileSorted } from "@/lib/scores/math";
import {
  BASELINE_DAYS,
  LOOKBACK_DAYS,
  MIN_BASELINE_VALUES,
  type Baseline,
  type DayMetrics,
  type HourRow,
  type NightRow,
  type ScoreInputs,
  type ScoreUser,
} from "@/lib/scores/types";

/** Minimum SD per baseline metric (canonical units). */
export const SD_FLOOR = {
  resting_hr: 1.5, // bpm
  hrv_sdnn_ms: 4, // ms
  resp_rate: 0.4, // breaths/min
  sleep_score: 5, // points
} as const;

/** MAD -> SD for normally distributed data. */
const MAD_TO_SD = 1.4826;

/**
 * Robust mean / SD of `values` (non-finite entries ignored). Null when fewer
 * than `minValues` valid values.
 */
export function robustBaseline(
  values: readonly (number | null | undefined)[],
  sdFloor = 0,
  minValues = MIN_BASELINE_VALUES,
): Baseline | null {
  const xs = values.filter(isNum);
  const n = xs.length;
  if (n < minValues || n === 0) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const med = quantileSorted(sorted, 0.5);
  const madSd = MAD_TO_SD * median(sorted.map((x) => Math.abs(x - med)));
  const band = 3 * Math.max(madSd, sdFloor);
  const lo = Math.max(quantileSorted(sorted, 0.05), med - band);
  const hi = Math.min(quantileSorted(sorted, 0.95), med + band);
  const clipped = sorted.map((x) => Math.min(hi, Math.max(lo, x)));
  const mean = clipped.reduce((s, x) => s + x, 0) / n;
  const variance = n > 1 ? clipped.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1) : 0;
  return { mean, sd: Math.max(Math.sqrt(variance), sdFloor), n };
}

/** The `n` dates before `date`, oldest first (D-n..D-1). */
export function priorDates(date: string, n = BASELINE_DAYS): string[] {
  const out: string[] = [];
  for (let k = n; k >= 1; k--) out.push(addDays(date, -k));
  return out;
}

/** Values of `pick` over D-30..D-1 (nulls kept, so callers can count days). */
export function windowValues<T>(
  byDate: ReadonlyMap<string, T>,
  date: string,
  pick: (row: T) => number | null | undefined,
  days = BASELINE_DAYS,
): (number | null)[] {
  return priorDates(date, days).map((d) => {
    const row = byDate.get(d);
    const v = row === undefined ? null : pick(row);
    return isNum(v) ? v : null;
  });
}

/* ------------------------------------------------------------------------ */
/* Loading                                                                   */
/* ------------------------------------------------------------------------ */

export type LoadOptions = {
  /** Days of history before `from` to load for baselines (default 60). */
  lookbackDays?: number;
};

export async function loadScoreUser(db: Executor, userId: string): Promise<ScoreUser | null> {
  const [u] = await db
    .select({ id: users.id, timezone: users.timezone, dob: users.dob, maxHr: users.maxHr, sleepGoalMin: users.sleepGoalMin })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!u) return null;
  return { ...u, timezone: u.timezone || "UTC" };
}

/**
 * One query per table: daily metrics and nights for [from - lookback, to],
 * hourly HR for [from, to] (only strain uses it, and only for the day
 * itself), and which wake dates have real in-bed samples.
 */
export async function loadScoreInputs(
  db: Executor,
  user: ScoreUser,
  from: string,
  to: string,
  opts: LoadOptions = {},
): Promise<ScoreInputs> {
  const start = addDays(from, -(opts.lookbackDays ?? LOOKBACK_DAYS));
  const uid = user.id;
  const [metricRows, hrRows, nightRows, inBedRows] = await Promise.all([
    db
      .select({
        date: dailyMetrics.localDate,
        resting_hr: dailyMetrics.resting_hr,
        hrv_sdnn_ms: dailyMetrics.hrv_sdnn_ms,
        resp_rate: dailyMetrics.resp_rate,
        active_kcal: dailyMetrics.active_kcal,
        exercise_min: dailyMetrics.exercise_min,
        steps: dailyMetrics.steps,
      })
      .from(dailyMetrics)
      .where(and(eq(dailyMetrics.userId, uid), between(dailyMetrics.localDate, start, to))),
    db
      .select({ date: hrHourly.localDate, hour: hrHourly.hour, min: hrHourly.min, avg: hrHourly.avg, max: hrHourly.max })
      .from(hrHourly)
      .where(and(eq(hrHourly.userId, uid), between(hrHourly.localDate, from, to)))
      .orderBy(asc(hrHourly.localDate), asc(hrHourly.hour)),
    db
      .select()
      .from(sleepNights)
      .where(and(eq(sleepNights.userId, uid), between(sleepNights.wakeDate, start, to))),
    db
      .select({ date: sleepSegments.wakeDate })
      .from(sleepSegments)
      .where(and(eq(sleepSegments.userId, uid), between(sleepSegments.wakeDate, start, to), eq(sleepSegments.stage, "in_bed")))
      .groupBy(sleepSegments.wakeDate),
  ]);

  const metrics = new Map<string, DayMetrics>();
  for (const { date, ...m } of metricRows) metrics.set(date, m);

  const hr = new Map<string, HourRow[]>();
  for (const r of hrRows) {
    const row: HourRow = { hour: r.hour, min: r.min, avg: r.avg, max: r.max };
    const list = hr.get(r.date);
    if (list) list.push(row);
    else hr.set(r.date, [row]);
  }

  const measured = new Set(inBedRows.map((r) => r.date));
  const nights = new Map<string, NightRow>();
  for (const n of nightRows) {
    nights.set(n.wakeDate, {
      wakeDate: n.wakeDate,
      chosenSource: n.chosenSource,
      bedStart: n.bedStart.getTime(),
      bedEnd: n.bedEnd.getTime(),
      inBedMin: n.inBedMin,
      asleepMin: n.asleepMin,
      awakeMin: n.awakeMin,
      coreMin: n.coreMin,
      deepMin: n.deepMin,
      remMin: n.remMin,
      hasStages: n.hasStages,
      inBedMeasured: measured.has(n.wakeDate),
    });
  }
  return { user, metrics, hr, nights };
}
