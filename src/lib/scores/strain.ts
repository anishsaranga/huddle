/**
 * Strain, 0-21 (Huddle's own formula, pure): how much cardiovascular and
 * physical load a local day carried.
 *
 * Heart-rate reserve: maxHR = the user's max_hr, else Tanaka 208 - 0.7 x age
 * (age at D from dob), else 190. RHR = that day's resting HR, else the 30-day
 * baseline RHR, else 60. HRR = maxHR - RHR (at least 30 bpm).
 *
 * Cardio load, per local hour with HR data:
 *   intensity I = clamp((avg - RHR) / HRR, 0, 1)
 *   peak      P = clamp((max - RHR) / HRR, 0, 1)            (when max exists)
 *   load_h = 60 x (I^2 + 0.4 x min(I, 0.08))  +  60 x 6 x max(0, P - 0.6)^2
 * - I^2 is the training load: hard hours count far more than easy ones.
 * - 0.4 x min(I, 0.08) is a small "daily living" credit: the first ~10 bpm
 *   above RHR in every waking hour. Without it a sedentary day reads ~1-2
 *   because squares of small intensities vanish; capped so an active but
 *   workout-free day doesn't read like a training day.
 * - The peak bonus captures short hard efforts that an hourly average hides
 *   (a 20-minute interval block barely moves an hour's mean).
 *
 * Activity load A = active_kcal / 10 + exercise_min x 0.8.
 *   - With HR data, load = cardio + 0.35 x A (most of A is already in the HR).
 *   - Without any HR hour (e.g. an iPhone-only user), A drives it alone:
 *     load = 0.8 x A + 31 x min(1, steps / 3000) (the second term stands in
 *     for the daily-living credit HR would have given; without steps,
 *     active_kcal / 130 is used as the day's share of it).
 *
 * strain = 21 x (1 - e^(-load / 152)), one decimal.
 *
 * Calibration (fixtures in tests/unit/scores-strain.test.ts; RHR 60, maxHR
 * 190, so HRR 130; 8 sleeping hours at RHR; other hours as noted):
 *   sedentary  3k steps, 130 kcal, no exercise; waking hours at RHR+10     -> 4.8  (target 4-6)
 *   typical    9k steps, 20 min brisk walk, 420 kcal; waking hours at
 *              RHR+18..24 (an ordinary day on your feet)                    -> 8.6  (7-9)
 *   moderate   45 min run at 60-70 % HRR split over two clock hours (hour
 *              avgs 40 / 28 % HRR, peaks 72 / 70 %), 480 kcal; rest RHR+13 -> 9.5  (9-11)
 *   hard       90 min intervals, peaks > 85 % HRR (hour avgs 30 / 72 / 55 %,
 *              peaks 60 / 92 / 88 %), 950 kcal, 90 min exercise            -> 16.0 (15-17)
 *   extreme    3.5 h endurance (hour avgs 35 / 66 / 68 / 66 / 55 %),
 *              2100 kcal, 210 min exercise                                -> 19.0 (18-20)
 * The same days without HR (activity only) land at 5.0 / 8.4 / 10.0 / 13.9
 * / 18.7: without HR there's no telling how hard the hard day was.
 * The coefficients (living credit and cap, peak factor 6, k) were fit by a
 * small grid search over these fixtures, keeping the 0.35 activity blend.
 */

import { clamp, isNum, round } from "@/lib/scores/math";
import type { DayMetrics, HourRow } from "@/lib/scores/types";

export const STRAIN_MAX = 21;
export const STRAIN_K = 152;
export const LIVING_COEF = 0.4;
export const LIVING_CAP = 0.08;
export const PEAK_THRESHOLD = 0.6;
export const PEAK_BONUS = 6;
export const ACTIVITY_BLEND = 0.35;
export const ACTIVITY_ONLY_SCALE = 0.8;
export const DAILY_LIVING_LOAD = 31;
export const DAILY_LIVING_STEPS = 3000;
export const DEFAULT_MAX_HR = 190;
export const DEFAULT_RHR = 60;
const MIN_RESERVE = 30;

/** %HRR zone bounds (zone 1 = 50-60 %, ..., zone 5 = 90-100 %). */
export const ZONE_BOUNDS = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0001] as const;
export type Zones = { z1: number; z2: number; z3: number; z4: number; z5: number };

export type MaxHrSource = "profile" | "age" | "default";
export type RhrSource = "day" | "baseline" | "default";

export type StrainResult = {
  strain: number | null;
  components: {
    cardioLoad: number;
    activityLoad: number;
    /** Total load that went into the curve. */
    load: number;
    hoursWithHr: number;
    maxHr: number;
    maxHrSource: MaxHrSource;
    rhr: number;
    rhrSource: RhrSource;
    /** "hr" (cardio + 0.35 x activity) or "activity" (no HR hours). */
    basis: "hr" | "activity" | null;
  };
  /** Estimated minutes per HR zone (from the hourly min/avg/max). */
  zones: Zones;
  reason?: "no_data";
};

/** Whole years from `dob` to `date` (both `YYYY-MM-DD`). */
export function ageOn(dob: string, date: string): number {
  const [by, bm, bd] = dob.split("-").map(Number);
  const [y, m, d] = date.split("-").map(Number);
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

export function resolveMaxHr(maxHr: number | null, dob: string | null, date: string): { value: number; source: MaxHrSource } {
  if (isNum(maxHr) && maxHr > 0) return { value: maxHr, source: "profile" };
  if (dob) {
    const age = ageOn(dob, date);
    if (age >= 5 && age <= 110) return { value: round(208 - 0.7 * age, 1), source: "age" };
  }
  return { value: DEFAULT_MAX_HR, source: "default" };
}

export function resolveRhr(dayRhr: number | null, baselineRhr: number | null): { value: number; source: RhrSource } {
  if (isNum(dayRhr)) return { value: dayRhr, source: "day" };
  if (isNum(baselineRhr)) return { value: round(baselineRhr, 1), source: "baseline" };
  return { value: DEFAULT_RHR, source: "default" };
}

/** Load of one hour (see the header). */
export function hourLoad(row: HourRow, rhr: number, reserve: number): number {
  const i = clamp((row.avg - rhr) / reserve, 0, 1);
  let load = 60 * (i * i + LIVING_COEF * Math.min(i, LIVING_CAP));
  if (isNum(row.max)) {
    const p = clamp((row.max - rhr) / reserve, 0, 1);
    load += 60 * PEAK_BONUS * Math.max(0, p - PEAK_THRESHOLD) ** 2;
  }
  return load;
}

/** A = active_kcal / 10 + exercise_min x 0.8 (missing values count as 0). */
export function activityLoad(m: Pick<DayMetrics, "active_kcal" | "exercise_min">): number {
  return (isNum(m.active_kcal) ? m.active_kcal / 10 : 0) + (isNum(m.exercise_min) ? m.exercise_min * 0.8 : 0);
}

/** Share (0-1) of the daily-living load an activity-only day gets. */
function livingShare(m: Pick<DayMetrics, "active_kcal" | "steps">): number {
  if (isNum(m.steps)) return Math.min(1, m.steps / DAILY_LIVING_STEPS);
  if (isNum(m.active_kcal)) return Math.min(1, m.active_kcal / 130);
  return 0;
}

export const strainFromLoad = (load: number): number => round(STRAIN_MAX * (1 - Math.exp(-Math.max(0, load) / STRAIN_K)), 1);

/**
 * Minutes of one hour spent in each zone. The hour's HR is modeled as
 * HR(t) = min + (max - min) x t^p over t in [0, 1], with p chosen so the mean
 * equals `avg` (p = (max - min) / (avg - min) - 1); the time above a level h
 * is then 1 - ((h - min) / (max - min))^(1/p). A rough, deterministic estimate
 * that puts short peaks in the upper zones without inventing minutes.
 */
export function hourZones(row: HourRow, rhr: number, reserve: number): number[] {
  const out = [0, 0, 0, 0, 0];
  const bpm = (f: number) => rhr + f * reserve;
  const zoneOf = (hr: number) => {
    for (let z = 4; z >= 0; z--) if (hr >= bpm(ZONE_BOUNDS[z])) return z;
    return -1;
  };
  const max = isNum(row.max) ? Math.max(row.max, row.avg) : null;
  if (max === null || max - row.avg < 0.5) {
    const z = zoneOf(row.avg);
    if (z >= 0) out[z] = 60;
    return out;
  }
  let min = isNum(row.min) ? Math.min(row.min, row.avg) : row.avg - (max - row.avg) / 2;
  if (row.avg - min < 0.5) min = row.avg - 0.5;
  const p = clamp((max - min) / (row.avg - min) - 1, 0.05, 20);
  // Fraction of the hour with HR below h.
  const below = (h: number) => clamp((h - min) / (max - min), 0, 1) ** (1 / p);
  for (let z = 0; z < 5; z++) out[z] = 60 * Math.max(0, below(bpm(ZONE_BOUNDS[z + 1])) - below(bpm(ZONE_BOUNDS[z])));
  return out;
}

export type StrainInput = {
  date: string;
  hours: readonly HourRow[];
  metrics: Pick<DayMetrics, "resting_hr" | "active_kcal" | "exercise_min" | "steps"> | undefined;
  user: { maxHr: number | null; dob: string | null };
  /** The robust 30-day RHR baseline mean (null when none). */
  baselineRhr: number | null;
};

export function scoreStrain({ date, hours, metrics, user, baselineRhr }: StrainInput): StrainResult {
  const maxHr = resolveMaxHr(user.maxHr, user.dob, date);
  const rhr = resolveRhr(metrics?.resting_hr ?? null, baselineRhr);
  const reserve = Math.max(maxHr.value - rhr.value, MIN_RESERVE);
  const m = metrics ?? { resting_hr: null, active_kcal: null, exercise_min: null, steps: null };
  const hasActivity = isNum(m.active_kcal) || isNum(m.exercise_min) || isNum(m.steps);

  let cardio = 0;
  const zoneTotals = [0, 0, 0, 0, 0];
  for (const h of hours) {
    cardio += hourLoad(h, rhr.value, reserve);
    const z = hourZones(h, rhr.value, reserve);
    for (let i = 0; i < 5; i++) zoneTotals[i] += z[i];
  }
  const activity = activityLoad(m);
  const zones: Zones = {
    z1: Math.round(zoneTotals[0]),
    z2: Math.round(zoneTotals[1]),
    z3: Math.round(zoneTotals[2]),
    z4: Math.round(zoneTotals[3]),
    z5: Math.round(zoneTotals[4]),
  };
  const common = { hoursWithHr: hours.length, maxHr: maxHr.value, maxHrSource: maxHr.source, rhr: rhr.value, rhrSource: rhr.source };

  if (hours.length === 0 && !hasActivity) {
    return {
      strain: null,
      components: { cardioLoad: 0, activityLoad: 0, load: 0, basis: null, ...common },
      zones,
      reason: "no_data",
    };
  }
  const basis = hours.length > 0 ? "hr" : "activity";
  const load =
    basis === "hr" ? cardio + ACTIVITY_BLEND * activity : ACTIVITY_ONLY_SCALE * activity + DAILY_LIVING_LOAD * livingShare(m);
  return {
    strain: strainFromLoad(load),
    components: { cardioLoad: round(cardio, 1), activityLoad: round(activity, 1), load: round(load, 1), basis, ...common },
    zones,
  };
}
