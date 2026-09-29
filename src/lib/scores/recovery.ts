/**
 * Recovery, 0-100 (Huddle's own formula, pure).
 *
 * Recovery on date D is "how ready are you this morning", from the night that
 * ended on D and that day's vitals:
 *
 *   input            direction        base weight   with HRV
 *   resting HR       lower is better   45            31.5
 *   sleep score      higher is better  40            28
 *   respiratory rate lower is better   15            10.5
 *   HRV (SDNN)       higher is better   -             30
 *
 * Each input is a z-score against its own robust 30-day baseline (D-30..D-1,
 * >= 4 values, SD floored: RHR 1.5 bpm, HRV 4 ms, resp 0.4 /min, sleep 5),
 * clamped to +/-3 so one wild reading can't decide the day, and signed so
 * "better" is positive. An input counts only when it has a value on D AND a
 * baseline. Weights are rescaled over the inputs that count, and the
 * composite z = sum(weight x signed z) is mapped through a logistic:
 *
 *   recovery = 100 / (1 + e^(-1.6 x (shrink x z + Z0))),  Z0 = ln(0.58 / 0.42) / 1.6
 *
 * so an ordinary day (z = 0) reads 58 (upper yellow), z = +0.5 -> 75,
 * z = +1 -> 87, z = -0.5 -> 38, z = -1 -> 22. Clamped to 1-99.
 * Bands: green >= 67, yellow 34-66, red <= 33.
 *
 * Shrink for partial data: the user's "full" input set is every input that
 * has a baseline (>= 4 values in D-30..D-1), so a device that never writes
 * HRV or resp isn't penalized. When only some of those are present today,
 * the composite z is pulled toward 0 by
 *
 *   shrink = sqrt(base weight present / base weight of the full set)
 *
 * (base weights 45/40/15, or 31.5/28/10.5 + HRV 30 when HRV is in the full
 * set). An RHR-only morning for a no-HRV user: sqrt(45/100) = 0.67; for a
 * Watch user: sqrt(31.5/100) = 0.56. A Zepp user with RHR + sleep baselines
 * and both present today: 1 (no shrink). Less evidence, less extreme swings.
 *
 * Null when neither resting HR nor sleep score exists on D (`no_data`), or
 * when they exist but neither has 4 baseline days yet (`calibrating`, with
 * `calibrationDaysLeft`).
 *
 * `limited` means "missing something you normally have": true only when an
 * input in the user's expected set (inputs with a baseline) has no value today.
 * A Fitbit user (no HRV, ever) with resting HR + resp + sleep is NOT limited.
 * `unsupported` lists inputs never available for the user (no baseline and no
 * value today, e.g. HRV for Fitbit) so the UI can say so calmly. `missing`
 * stays "inputs that didn't count today" (no value or no baseline).
 */

import { robustBaseline, SD_FLOOR } from "@/lib/scores/baseline";
import { clamp, isNum, renormalize, round } from "@/lib/scores/math";
import { MIN_BASELINE_VALUES, type Baseline } from "@/lib/scores/types";

export type RecoveryKey = "rhr" | "hrv" | "resp" | "sleep";
export type Direction = "higher" | "lower";
export type RecoveryBand = "green" | "yellow" | "red";

export const RECOVERY_KEYS: readonly RecoveryKey[] = ["rhr", "hrv", "resp", "sleep"];
export const RECOVERY_DIRECTION: Record<RecoveryKey, Direction> = { rhr: "lower", hrv: "higher", resp: "lower", sleep: "higher" };
export const BASE_WEIGHTS = { rhr: 45, sleep: 40, resp: 15 } as const;
export const HRV_WEIGHT = 30;
/** Base weights shrink by this factor when HRV takes its 30 %. */
export const HRV_SCALE = 0.7;
const SD_FLOORS: Record<RecoveryKey, number> = {
  rhr: SD_FLOOR.resting_hr,
  hrv: SD_FLOOR.hrv_sdnn_ms,
  resp: SD_FLOOR.resp_rate,
  sleep: SD_FLOOR.sleep_score,
};
export const Z_CLAMP = 3;
export const LOGISTIC_SLOPE = 1.6;
/** Shift that maps a composite z of 0 to 58. */
export const Z0 = Math.log(0.58 / 0.42) / LOGISTIC_SLOPE;

export type RecoveryValues = Record<RecoveryKey, number | null>;
export type RecoveryHistory = Record<RecoveryKey, readonly (number | null)[]>;

export type Contributor = {
  key: RecoveryKey;
  value: number;
  baseline: number;
  sd: number;
  /** Days in the baseline. */
  n: number;
  /** Raw z (clamped to +/-3), NOT direction-signed. */
  z: number;
  /** Normalized weight (all contributors sum to 1). */
  weight: number;
  direction: Direction;
  /** weight x signed z x shrink: this input's share of the final composite. */
  impact: number;
};

export type RecoveryReason = "no_data" | "calibrating";

export type RecoveryResult = {
  recovery: number | null;
  band: RecoveryBand | null;
  /** An input the user normally has (has a baseline) is missing today. */
  limited: boolean;
  /** Composite z after the partial-data shrink (null when no score). */
  z: number | null;
  /** Composite z before the shrink. */
  zRaw: number | null;
  /** Factor applied to zRaw (1 = every input with a baseline is present). */
  shrink: number | null;
  /** Inputs with a baseline (the user's "full" set for the shrink). */
  expected: RecoveryKey[];
  contributors: Contributor[];
  /** Inputs with no value today or no baseline yet. */
  missing: RecoveryKey[];
  /** Inputs never available for this user: no baseline and no value today. */
  unsupported: RecoveryKey[];
  reason?: RecoveryReason;
  /** Days of baseline still needed (only with reason `calibrating`). */
  calibrationDaysLeft?: number;
};

export function recoveryBand(recovery: number): RecoveryBand {
  if (recovery >= 67) return "green";
  if (recovery <= 33) return "red";
  return "yellow";
}

/** Composite z -> 1..99 (integer). */
export function recoveryFromZ(z: number): number {
  return clamp(Math.round(100 / (1 + Math.exp(-LOGISTIC_SLOPE * (z + Z0)))), 1, 99);
}

/** Weights for the present inputs (sum = 1). */
export function recoveryWeights(present: Readonly<Record<RecoveryKey, boolean>>): Record<RecoveryKey, number> {
  const scale = present.hrv ? HRV_SCALE : 1;
  return renormalize(
    { rhr: BASE_WEIGHTS.rhr * scale, sleep: BASE_WEIGHTS.sleep * scale, resp: BASE_WEIGHTS.resp * scale, hrv: HRV_WEIGHT },
    present,
  );
}

/** Base weights (not normalized) under the weight scheme of the user's full set. */
function baseWeights(hrvInScheme: boolean): Record<RecoveryKey, number> {
  const s = hrvInScheme ? HRV_SCALE : 1;
  return { rhr: BASE_WEIGHTS.rhr * s, sleep: BASE_WEIGHTS.sleep * s, resp: BASE_WEIGHTS.resp * s, hrv: hrvInScheme ? HRV_WEIGHT : 0 };
}

/**
 * sqrt(base weight present / base weight of the full set), where the full set
 * is the inputs with a baseline. 1 when nothing expected is missing.
 */
export function partialShrink(present: Readonly<Record<RecoveryKey, boolean>>, expected: Readonly<Record<RecoveryKey, boolean>>): number {
  const w = baseWeights(expected.hrv);
  let have = 0;
  let full = 0;
  for (const k of RECOVERY_KEYS) {
    if (!expected[k]) continue;
    full += w[k];
    if (present[k]) have += w[k];
  }
  return full > 0 ? Math.sqrt(have / full) : 0;
}

export function scoreRecovery(today: RecoveryValues, history: RecoveryHistory): RecoveryResult {
  const baselines = {} as Record<RecoveryKey, Baseline | null>;
  for (const k of RECOVERY_KEYS) baselines[k] = robustBaseline(history[k], SD_FLOORS[k]);
  const present = {} as Record<RecoveryKey, boolean>;
  for (const k of RECOVERY_KEYS) present[k] = isNum(today[k]) && baselines[k] !== null;
  const missing = RECOVERY_KEYS.filter((k) => !present[k]);
  const hasBaseline = {} as Record<RecoveryKey, boolean>;
  for (const k of RECOVERY_KEYS) hasBaseline[k] = baselines[k] !== null;
  const expected = RECOVERY_KEYS.filter((k) => hasBaseline[k]);
  const unsupported = RECOVERY_KEYS.filter((k) => !hasBaseline[k] && !isNum(today[k]));
  const none = { z: null, zRaw: null, shrink: null, expected, contributors: [] as Contributor[], missing, unsupported };

  const coreToday = (["rhr", "sleep"] as const).filter((k) => isNum(today[k]));
  if (coreToday.length === 0) {
    return { recovery: null, band: null, limited: true, ...none, reason: "no_data" };
  }
  if (!present.rhr && !present.sleep) {
    const have = Math.max(...coreToday.map((k) => history[k].filter(isNum).length));
    return {
      recovery: null,
      band: null,
      limited: true,
      ...none,
      reason: "calibrating",
      calibrationDaysLeft: Math.max(1, MIN_BASELINE_VALUES - have),
    };
  }

  const weights = recoveryWeights(present);
  const shrink = partialShrink(present, hasBaseline);
  const contributors: Contributor[] = [];
  let z = 0;
  for (const k of RECOVERY_KEYS) {
    if (!present[k]) continue;
    const b = baselines[k]!;
    const value = today[k]!;
    const raw = clamp((value - b.mean) / b.sd, -Z_CLAMP, Z_CLAMP);
    const signed = RECOVERY_DIRECTION[k] === "higher" ? raw : -raw;
    z += weights[k] * signed;
    contributors.push({
      key: k,
      value,
      baseline: round(b.mean, 2),
      sd: round(b.sd, 2),
      n: b.n,
      z: round(raw, 2),
      weight: round(weights[k], 4),
      direction: RECOVERY_DIRECTION[k],
      impact: round(weights[k] * signed * shrink, 3),
    });
  }
  const recovery = recoveryFromZ(z * shrink);
  return {
    recovery,
    band: recoveryBand(recovery),
    limited: expected.some((k) => !present[k]),
    z: round(z * shrink, 3),
    zRaw: round(z, 3),
    shrink: round(shrink, 4),
    expected,
    contributors,
    missing,
    unsupported,
  };
}
