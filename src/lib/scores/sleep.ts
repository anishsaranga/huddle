/**
 * Sleep score, 0-100 (Huddle's own formula, pure).
 *
 * Four components, each 0-100:
 *
 * - duration (50%): asleep minutes vs need (the user's sleep goal, default
 *   8 h). With r = asleep / need and x = (r - 0.4) / 0.6:
 *   score = 100 x smoothstep(x^1.286). 100 at r >= 1, ~50 at r = 0.75,
 *   0 at r <= 0.4, flat (zero slope) at both ends. r = 0.9 -> 89.
 * - efficiency (15%): asleep / in bed. 100 at >= 92 %, 0 at <= 65 %, linear.
 *   Omitted unless the night has real in-bed samples: without them the
 *   ingest falls back to the tracker's own first-to-last span, which misses
 *   the time spent falling asleep and isn't comparable.
 * - restorative (20%): (deep + REM) / asleep. 100 at >= 40 %, 0 at <= 15 %,
 *   linear. Omitted when the night has no stage detail.
 * - consistency (15%): how far tonight's bedtime and wake time are from the
 *   circular mean of the prior 7 nights (average of the two deviations, in
 *   clock minutes, so 23:50 vs 00:10 is 20 minutes). 100 at <= 15 min, 0 at
 *   >= 120 min, linear. Omitted with fewer than 3 prior nights.
 *
 * Weights 50/15/20/15 are rescaled over the components present.
 *
 * No data: no night -> null (`no_data`). A night with no asleep time (e.g. an
 * iPhone that only writes "In Bed") -> null (`in_bed_only`): time in bed alone
 * isn't sleep, and guessing would make phone-only users look well rested.
 */

import { localParts } from "@/lib/tz";
import { circularDiff, circularMean, isNum, ramp, renormalize, round, smoothstep } from "@/lib/scores/math";
import { CONSISTENCY_NIGHTS, type NightRow } from "@/lib/scores/types";

export const DEFAULT_SLEEP_NEED_MIN = 480;

export const SLEEP_WEIGHTS = { duration: 50, efficiency: 15, restorative: 20, consistency: 15 } as const;
export type SleepComponentKey = keyof typeof SLEEP_WEIGHTS;

/** Exponent that puts the duration curve's midpoint (50) at 75 % of need. */
const DURATION_SHAPE = Math.log(0.5) / Math.log((0.75 - 0.4) / 0.6);
const MIN_PRIOR_NIGHTS = 3;

export type SleepReason = "no_data" | "in_bed_only";

export type SleepResult = {
  score: number | null;
  components: Record<SleepComponentKey, number | null>;
  /** Weights actually used (sum to 1 over the present components; 0 = omitted). */
  weights: Record<SleepComponentKey, number>;
  needMin: number;
  asleepMin: number | null;
  inBedMin: number | null;
  /** asleep / in bed (0-1) when measured. */
  efficiency: number | null;
  /** (deep + REM) / asleep (0-1) when staged. */
  restorativeShare: number | null;
  /** Average bed/wake deviation from the prior nights (minutes). */
  consistencyDevMin: number | null;
  priorNights: number;
  reason?: SleepReason;
};

/** Duration component (0-100) for `asleepMin` against `needMin`. */
export function durationScore(asleepMin: number, needMin: number): number {
  const r = asleepMin / needMin;
  if (r >= 1) return 100;
  if (r <= 0.4) return 0;
  return 100 * smoothstep(((r - 0.4) / 0.6) ** DURATION_SHAPE);
}

export const efficiencyScore = (eff: number): number => 100 * ramp(eff, 0.65, 0.92);
export const restorativeScore = (share: number): number => 100 * ramp(share, 0.15, 0.4);
export const consistencyScore = (devMin: number): number => 100 * (1 - ramp(devMin, 15, 120));

/** Local clock minutes (0-1439) of instant `ms` in `tz`. */
export function clockMinutes(ms: number, tz: string): number {
  const p = localParts(ms, tz);
  return p.hour * 60 + p.minute + p.second / 60;
}

/**
 * Average of |bedtime - mean bedtime| and |wake - mean wake| (circular), vs
 * the prior nights. Null when fewer than 3 prior nights.
 */
export function consistencyDeviation(night: NightRow, prior: readonly NightRow[], tz: string): number | null {
  if (prior.length < MIN_PRIOR_NIGHTS) return null;
  const meanBed = circularMean(prior.map((n) => clockMinutes(n.bedStart, tz)));
  const meanWake = circularMean(prior.map((n) => clockMinutes(n.bedEnd, tz)));
  if (meanBed === null || meanWake === null) return 120; // all over the clock: as inconsistent as it gets
  const bedDev = circularDiff(clockMinutes(night.bedStart, tz), meanBed);
  const wakeDev = circularDiff(clockMinutes(night.bedEnd, tz), meanWake);
  return (bedDev + wakeDev) / 2;
}

export type SleepInput = {
  /** The night whose wake date is being scored (undefined = none). */
  night: NightRow | undefined;
  /** Nights with wake dates D-7..D-1 that exist, oldest first (only the last 7 are used). */
  prior: readonly NightRow[];
  /** The user's sleep goal in minutes (null = default 480). */
  needMin: number | null;
  tz: string;
};

const EMPTY_COMPONENTS: Record<SleepComponentKey, null> = { duration: null, efficiency: null, restorative: null, consistency: null };
const ZERO_WEIGHTS: Record<SleepComponentKey, number> = { duration: 0, efficiency: 0, restorative: 0, consistency: 0 };

export function scoreSleep({ night, prior, needMin: goal, tz }: SleepInput): SleepResult {
  const needMin = isNum(goal) && goal > 0 ? goal : DEFAULT_SLEEP_NEED_MIN;
  const base = {
    needMin,
    efficiency: null,
    restorativeShare: null,
    consistencyDevMin: null,
    priorNights: prior.length,
    components: { ...EMPTY_COMPONENTS },
    weights: { ...ZERO_WEIGHTS },
  };
  if (!night) return { ...base, score: null, asleepMin: null, inBedMin: null, reason: "no_data" };
  const asleep = night.asleepMin;
  if (!isNum(asleep) || asleep <= 0) {
    return { ...base, score: null, asleepMin: null, inBedMin: night.inBedMin, reason: "in_bed_only" };
  }

  const inBed = night.inBedMin;
  const efficiency = night.inBedMeasured && isNum(inBed) && inBed > 0 ? Math.min(1, asleep / inBed) : null;
  const restorativeShare = night.hasStages ? Math.min(1, ((night.deepMin ?? 0) + (night.remMin ?? 0)) / asleep) : null;
  const priorNights = prior.slice(-CONSISTENCY_NIGHTS);
  const dev = consistencyDeviation(night, priorNights, tz);

  const components: Record<SleepComponentKey, number | null> = {
    duration: durationScore(asleep, needMin),
    efficiency: efficiency === null ? null : efficiencyScore(efficiency),
    restorative: restorativeShare === null ? null : restorativeScore(restorativeShare),
    consistency: dev === null ? null : consistencyScore(dev),
  };
  const weights = renormalize(SLEEP_WEIGHTS, {
    duration: true,
    efficiency: components.efficiency !== null,
    restorative: components.restorative !== null,
    consistency: components.consistency !== null,
  });
  let score = 0;
  for (const k of Object.keys(weights) as SleepComponentKey[]) score += weights[k] * (components[k] ?? 0);

  return {
    score: Math.round(score),
    components: {
      duration: round(components.duration!, 1),
      efficiency: components.efficiency === null ? null : round(components.efficiency, 1),
      restorative: components.restorative === null ? null : round(components.restorative, 1),
      consistency: components.consistency === null ? null : round(components.consistency, 1),
    },
    weights,
    needMin,
    asleepMin: asleep,
    inBedMin: isNum(inBed) ? inBed : null,
    efficiency: efficiency === null ? null : round(efficiency, 3),
    restorativeShare: restorativeShare === null ? null : round(restorativeShare, 3),
    consistencyDevMin: dev === null ? null : round(dev, 1),
    priorNights: priorNights.length,
  };
}
