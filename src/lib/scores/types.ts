/**
 * Shared types and constants of the score engine (src/lib/scores). Everything
 * here is plain data: the formulas in sleep.ts / recovery.ts / strain.ts are
 * pure functions over these shapes, and baseline.ts loads them from the DB.
 *
 * Dates are local `YYYY-MM-DD` strings; instants are epoch milliseconds.
 */

import type { MetricValues } from "@/lib/health/fields";

/**
 * Bump whenever a formula or constant changes in a way that changes stored
 * scores. It is written into `daily_scores.components.v`, so stale rows can be
 * found (`scores:recompute` rewrites them).
 */
export const SCORE_VERSION = 3;

/** Personal baselines look at the 30 days before the date (D-30..D-1). */
export const BASELINE_DAYS = 30;
/** A baseline needs at least this many valid values. */
export const MIN_BASELINE_VALUES = 4;
/** Sleep consistency compares against the prior 7 nights. */
export const CONSISTENCY_NIGHTS = 7;
/**
 * How far back a recompute loads data: recovery on D needs sleep scores for
 * D-30..D-1, and each of those needs the 7 nights before it (37), plus slack.
 */
export const LOOKBACK_DAYS = 60;

/** The profile fields the formulas use. */
export type ScoreUser = {
  id: string;
  /** IANA zone; bed/wake clock times are read in it. */
  timezone: string;
  /** `YYYY-MM-DD` or null. */
  dob: string | null;
  maxHr: number | null;
  sleepGoalMin: number | null;
};

/** The daily metrics the engine reads (canonical units, null = no value). */
export type ScoreMetricName = "resting_hr" | "hrv_sdnn_ms" | "resp_rate" | "active_kcal" | "exercise_min" | "steps";
export type DayMetrics = Pick<MetricValues, ScoreMetricName>;

export type HourRow = { hour: number; min: number | null; avg: number; max: number | null };

/** A `sleep_nights` row (plus whether real in-bed samples exist for it). */
export type NightRow = {
  wakeDate: string;
  chosenSource: string;
  bedStart: number;
  bedEnd: number;
  inBedMin: number | null;
  asleepMin: number | null;
  awakeMin: number | null;
  coreMin: number | null;
  deepMin: number | null;
  remMin: number | null;
  hasStages: boolean;
  /**
   * True when the night has `in_bed` segments (from any source). When false,
   * `inBedMin` is only the chosen source's first-to-last span (the ingest
   * fallback), so it says nothing about time in bed and efficiency is omitted.
   */
  inBedMeasured: boolean;
};

/** Everything a recompute needs for one user, keyed by local date. */
export type ScoreInputs = {
  user: ScoreUser;
  metrics: Map<string, DayMetrics>;
  hr: Map<string, HourRow[]>;
  nights: Map<string, NightRow>;
};

/** Robust personal baseline of one metric. */
export type Baseline = { mean: number; sd: number; n: number };
