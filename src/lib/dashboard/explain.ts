/**
 * Words for the dashboard: why a score is missing, why recovery is "limited",
 * what a band means, why a sleep component was left out. Pure functions over
 * the stored score results (daily_scores.components), so the text always
 * matches what the formulas actually did.
 */

import type { RecoveryBand, RecoveryKey, RecoveryResult } from "@/lib/scores/recovery";
import type { SleepComponentKey, SleepResult } from "@/lib/scores/sleep";
import type { StrainResult } from "@/lib/scores/strain";
import { joinList } from "@/lib/dashboard/format";

/** What the user's history says about their device(s). */
export type DeviceFacts = { hasHrv: boolean; hasResp: boolean; hasRhr: boolean };

export const RECOVERY_INPUT_LABEL: Record<RecoveryKey, string> = {
  rhr: "resting HR",
  hrv: "HRV",
  resp: "breathing rate",
  sleep: "sleep",
};

/* ------------------------------------------------------------------ */
/* Dial reasons (tiny ALL-CAPS line under a null dial)                  */
/* ------------------------------------------------------------------ */

export function recoveryNullReason(
  rec: RecoveryResult | null | undefined,
  o: { isToday: boolean; facts: DeviceFacts; sleep?: SleepResult | null },
): string | null {
  if (rec && rec.recovery !== null) return null;
  if (rec?.reason === "calibrating") {
    const n = rec.calibrationDaysLeft ?? 0;
    return `CALIBRATING · ${n} ${n === 1 ? "DAY" : "DAYS"}`;
  }
  // Recovery needs resting HR or a sleep score. A phone alone gives neither.
  if (!o.facts.hasRhr && (!o.sleep || o.sleep.score === null)) return "NEEDS A TRACKER";
  return o.isToday ? "SYNC TO SEE" : "NO DATA";
}

export function sleepNullReason(sleep: SleepResult | null | undefined, o: { isToday: boolean }): string | null {
  if (sleep && sleep.score !== null) return null;
  if (sleep?.reason === "in_bed_only") return "NO SLEEP DATA";
  return o.isToday ? "SYNC TO SEE" : "NO SLEEP DATA";
}

export function strainNullReason(strain: StrainResult | null | undefined, o: { isToday: boolean }): string | null {
  if (strain && strain.strain !== null) return null;
  return o.isToday ? "SYNC TO SEE" : "NO DATA";
}

/* ------------------------------------------------------------------ */
/* Recovery                                                            */
/* ------------------------------------------------------------------ */

export const BAND_COPY: Record<RecoveryBand, { title: string; body: string }> = {
  green: { title: "Primed", body: "Your body is ready to take on strain today." },
  yellow: { title: "Holding steady", body: "Moderate strain is fine. Listen to your body." },
  red: { title: "Run down", body: "Prioritize rest, easy movement and an early night." },
};

/**
 * Why a recovery score is "limited", in one sentence: inputs the device never
 * sends, inputs still building a baseline, and inputs missing on this day,
 * followed by what the score was built from. Null when not limited.
 *
 *   "Your Fitbit doesn't share HRV with Apple Health — recovery uses resting HR, sleep and breathing rate."
 */
export function limitedExplainer(rec: RecoveryResult | null | undefined, facts: DeviceFacts, device: string): string | null {
  if (!rec || rec.recovery === null || !rec.limited || rec.missing.length === 0) return null;
  const neverSent = (k: RecoveryKey) =>
    (k === "hrv" && !facts.hasHrv) || (k === "resp" && !facts.hasResp) || (k === "rhr" && !facts.hasRhr);
  const never = rec.missing.filter(neverSent);
  const calibrating = rec.missing.filter((k) => !neverSent(k) && !rec.expected.includes(k));
  const today = rec.missing.filter((k) => !neverSent(k) && rec.expected.includes(k));

  const parts: string[] = [];
  if (never.length) {
    const who = device === "tracker" ? "Your tracker" : `Your ${device}`;
    parts.push(`${who} doesn't share ${joinList(never.map((k) => RECOVERY_INPUT_LABEL[k]), "or")} with Apple Health`);
  }
  if (calibrating.length) {
    const what = joinList(calibrating.map((k) => RECOVERY_INPUT_LABEL[k]));
    parts.push(`${capitalize(what)} ${calibrating.length === 1 ? "is" : "are"} still building a baseline`);
  }
  if (today.length) {
    const labels = today.map((k) => (k === "sleep" ? "sleep score" : RECOVERY_INPUT_LABEL[k]));
    parts.push(`No ${joinList(labels, "or")} for this day`);
  }
  const used = rec.contributors.map((c) => RECOVERY_INPUT_LABEL[c.key]);
  return `${parts.join(". ")} — recovery uses ${used.length ? joinList(used) : "what's available"}.`;
}

/**
 * A calm, neutral line for inputs this user's devices never provide, shown
 * only when recovery is NOT limited (nothing is missing that they normally
 * have). Null when nothing is unsupported or there's no score.
 *
 *   "HRV isn't shared by your Fitbit — recovery uses resting HR, breathing rate and sleep."
 */
export function unsupportedNote(rec: RecoveryResult | null | undefined, device: string): string | null {
  const unsupported = rec?.unsupported ?? [];
  if (!rec || rec.recovery === null || rec.limited || unsupported.length === 0) return null;
  const who = device === "tracker" ? "your tracker" : `your ${device}`;
  const what = joinList(unsupported.map((k) => RECOVERY_INPUT_LABEL[k]));
  const verb = unsupported.length === 1 ? "isn't" : "aren't";
  const used = rec.contributors.map((c) => RECOVERY_INPUT_LABEL[c.key]);
  return `${capitalize(what)} ${verb} shared by ${who} — recovery uses ${used.length ? joinList(used) : "what's available"}.`;
}

/** Calibration progress for the "3 of 4 days" ring. */
export function calibrationProgress(rec: RecoveryResult | null | undefined, needed = 4): { done: number; needed: number } | null {
  if (!rec || rec.reason !== "calibrating") return null;
  const left = Math.min(needed, Math.max(0, rec.calibrationDaysLeft ?? needed));
  return { done: needed - left, needed };
}

/* ------------------------------------------------------------------ */
/* Sleep                                                               */
/* ------------------------------------------------------------------ */

export const SLEEP_COMPONENT_LABEL: Record<SleepComponentKey, string> = {
  duration: "Hours vs need",
  efficiency: "Efficiency",
  restorative: "Restorative",
  consistency: "Consistency",
};

/** Why a sleep component was left out of the score (null when it's present). */
export function sleepComponentMissingWhy(
  key: SleepComponentKey,
  sleep: SleepResult,
  o: { device: string; hasStages: boolean },
): string | null {
  if (sleep.components[key] !== null) return null;
  switch (key) {
    case "duration":
      return "No time asleep was recorded";
    case "efficiency":
      return `${o.device === "tracker" ? "Your tracker" : o.device} didn't record time in bed`;
    case "restorative":
      return o.hasStages ? "Not enough stage detail" : `Stages not available from ${o.device}`;
    case "consistency":
      return `Needs 3 nights of history (${sleep.priorNights} so far)`;
  }
}

const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
