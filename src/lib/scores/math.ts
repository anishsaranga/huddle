/** Small numeric helpers shared by the score formulas (pure). */

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** 0 at `lo`, 1 at `hi`, linear between (works for lo > hi too), clamped. */
export function ramp(v: number, lo: number, hi: number): number {
  if (hi === lo) return v >= hi ? 1 : 0;
  return clamp((v - lo) / (hi - lo), 0, 1);
}

/** Hermite smoothstep on [0, 1]: zero slope at both ends. */
export function smoothstep(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

export const round = (v: number, decimals = 0): number => {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
};

export const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Linear-interpolated quantile of an ascending-sorted array (q in [0, 1]). */
export function quantileSorted(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * clamp(q, 0, 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function median(values: readonly number[]): number {
  return quantileSorted([...values].sort((a, b) => a - b), 0.5);
}

/** Rescale `weights` over the keys whose value is present (sum = 1). All zero if none present. */
export function renormalize<K extends string>(
  weights: Readonly<Record<K, number>>,
  present: Readonly<Record<K, boolean>>,
): Record<K, number> {
  const keys = Object.keys(weights) as K[];
  const total = keys.reduce((s, k) => s + (present[k] ? weights[k] : 0), 0);
  return Object.fromEntries(keys.map((k) => [k, present[k] && total > 0 ? weights[k] / total : 0])) as Record<K, number>;
}

/* ------------------------------------------------------------------------ */
/* Clock-time (circular) math, in minutes of a 1440-minute day               */
/* ------------------------------------------------------------------------ */

export const DAY_MIN = 1440;

/** Normalize to [0, 1440). */
export const wrapMinutes = (m: number): number => ((m % DAY_MIN) + DAY_MIN) % DAY_MIN;

/** Shortest distance between two clock times (0..720), e.g. 23:50 vs 00:10 = 20. */
export function circularDiff(a: number, b: number): number {
  const d = Math.abs(wrapMinutes(a) - wrapMinutes(b));
  return Math.min(d, DAY_MIN - d);
}

/** Circular mean of clock times (minutes); null when they cancel out (no meaningful mean). */
export function circularMean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  let s = 0;
  let c = 0;
  for (const v of values) {
    const a = (wrapMinutes(v) / DAY_MIN) * 2 * Math.PI;
    s += Math.sin(a);
    c += Math.cos(a);
  }
  if (Math.hypot(s, c) / values.length < 1e-6) return null;
  return wrapMinutes((Math.atan2(s, c) / (2 * Math.PI)) * DAY_MIN);
}
