/**
 * Signal colors. Color is used ONLY to carry meaning (recovery band, strain,
 * sleep); everything else is greyscale. Values are CSS custom properties
 * defined in globals.css, so always apply them via `style` (not SVG
 * presentation attributes, which don't resolve `var()` reliably).
 */

export const SIGNAL = {
  green: "var(--recovery-green)",
  yellow: "var(--recovery-yellow)",
  red: "var(--recovery-red)",
  strain: "var(--strain)",
  sleep: "var(--sleep)",
} as const;

/** Upper bound of the strain scale. */
export const STRAIN_MAX = 21;

export type RecoveryBand = "green" | "yellow" | "red";

/** ≥67 green, 34–66 yellow, ≤33 red. */
export function recoveryBand(pct: number): RecoveryBand {
  if (pct >= 67) return "green";
  if (pct >= 34) return "yellow";
  return "red";
}

export function recoveryColor(pct: number): string {
  return SIGNAL[recoveryBand(pct)];
}

export type SleepStage = "awake" | "rem" | "core" | "deep";

/** Sleep-stage palette: periwinkle family, lightest = most awake. */
export const STAGE_COLORS: Record<SleepStage, string> = {
  awake: "var(--stage-awake)",
  rem: "var(--stage-rem)",
  core: "var(--stage-core)",
  deep: "var(--stage-deep)",
};

export const STAGE_LABELS: Record<SleepStage, string> = {
  awake: "Awake",
  rem: "REM",
  core: "Core",
  deep: "Deep",
};

/** Top-to-bottom row order in a hypnogram. */
export const STAGE_ORDER: SleepStage[] = ["awake", "rem", "core", "deep"];

/** Good/bad delta color. `higherIsBetter` decides which direction is good. */
export function deltaColor(delta: number, higherIsBetter: boolean): string {
  if (delta === 0) return "var(--muted)";
  const good = higherIsBetter ? delta > 0 : delta < 0;
  return good ? SIGNAL.green : SIGNAL.red;
}

/** Translucent version of any CSS color (works with var()). */
export function alpha(color: string, pct: number): string {
  return `color-mix(in srgb, ${color} ${pct}%, transparent)`;
}
