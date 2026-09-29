/**
 * One day's scores from a user's loaded inputs (pure, no DB).
 *
 * Sleep scores are memoized per context: recovery on D z-scores that night's
 * sleep score against the sleep scores of D-30..D-1, so those are computed
 * (once) before any recovery that needs them. Everything is derived from the
 * raw tables, never from previously stored scores, so a recompute is
 * idempotent and independent of the order data arrived in.
 */

import { priorDates, robustBaseline, SD_FLOOR, windowValues } from "@/lib/scores/baseline";
import { scoreRecovery, type RecoveryResult } from "@/lib/scores/recovery";
import { scoreSleep, type SleepResult } from "@/lib/scores/sleep";
import { scoreStrain, type StrainResult } from "@/lib/scores/strain";
import { CONSISTENCY_NIGHTS, SCORE_VERSION, type NightRow, type ScoreInputs } from "@/lib/scores/types";

export type ScoreContext = ScoreInputs & { sleepCache: Map<string, SleepResult> };

export type DayScores = { date: string; sleep: SleepResult; recovery: RecoveryResult; strain: StrainResult };

/** `daily_scores.components`: everything the UI needs to explain a score. */
export type ScoreComponents = {
  v: number;
  sleep: SleepResult;
  recovery: RecoveryResult;
  strain: StrainResult;
};

export function createContext(inputs: ScoreInputs): ScoreContext {
  return { ...inputs, sleepCache: new Map() };
}

/** The sleep result for wake date `date` (memoized). */
export function sleepFor(ctx: ScoreContext, date: string): SleepResult {
  const cached = ctx.sleepCache.get(date);
  if (cached) return cached;
  const prior: NightRow[] = [];
  for (const d of priorDates(date, CONSISTENCY_NIGHTS)) {
    const n = ctx.nights.get(d);
    if (n) prior.push(n);
  }
  const result = scoreSleep({ night: ctx.nights.get(date), prior, needMin: ctx.user.sleepGoalMin, tz: ctx.user.timezone });
  ctx.sleepCache.set(date, result);
  return result;
}

/** Does the date have any stored input at all (metrics, hourly HR, or a night)? */
export function hasInputs(ctx: ScoreContext, date: string): boolean {
  return ctx.metrics.has(date) || (ctx.hr.get(date)?.length ?? 0) > 0 || ctx.nights.has(date);
}

export function computeDay(ctx: ScoreContext, date: string): DayScores {
  const sleep = sleepFor(ctx, date);
  const today = ctx.metrics.get(date);
  const rhrHistory = windowValues(ctx.metrics, date, (m) => m.resting_hr);

  const recovery = scoreRecovery(
    { rhr: today?.resting_hr ?? null, hrv: today?.hrv_sdnn_ms ?? null, resp: today?.resp_rate ?? null, sleep: sleep.score },
    {
      rhr: rhrHistory,
      hrv: windowValues(ctx.metrics, date, (m) => m.hrv_sdnn_ms),
      resp: windowValues(ctx.metrics, date, (m) => m.resp_rate),
      sleep: priorDates(date).map((d) => sleepFor(ctx, d).score),
    },
  );

  const strain = scoreStrain({
    date,
    hours: ctx.hr.get(date) ?? [],
    metrics: today,
    user: ctx.user,
    baselineRhr: robustBaseline(rhrHistory, SD_FLOOR.resting_hr)?.mean ?? null,
  });

  return { date, sleep, recovery, strain };
}

/** The `daily_scores` column values for a day's scores. */
export function toScoreRow(s: DayScores): { sleepScore: number | null; recovery: number | null; strain: number | null; components: ScoreComponents } {
  return {
    sleepScore: s.sleep.score,
    recovery: s.recovery.recovery,
    strain: s.strain.strain,
    components: { v: SCORE_VERSION, sleep: s.sleep, recovery: s.recovery, strain: s.strain },
  };
}
