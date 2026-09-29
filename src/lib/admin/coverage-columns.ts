/**
 * Columns of the admin "Data coverage" grid: every metric from
 * src/lib/health/fields.ts (grouped by its category) plus three derived
 * columns (hourly heart rate, sleep nights, nights with stages).
 *
 * Pure and dependency-free (no db import), so client components can use it.
 */

import { METRIC_FIELDS, type MetricCategory, type MetricName } from "@/lib/health/fields";

export type CoverageGroupId = MetricCategory | "sleep";

export type CoverageGroup = { id: CoverageGroupId; label: string };

export type CoverageColumn = {
  /** Metric name, or one of the EXTRA_COLUMN_KEYS. */
  key: string;
  /** Full label (detail sheet, aria). */
  label: string;
  /** Compact ALL-CAPS header. */
  short: string;
  group: CoverageGroupId;
};

export const COVERAGE_GROUPS: readonly CoverageGroup[] = [
  { id: "activity", label: "Activity" },
  { id: "heart", label: "Heart" },
  { id: "vitals", label: "Vitals" },
  { id: "sleep", label: "Sleep" },
  { id: "body", label: "Body" },
];

/** Keys of the columns that don't come from `daily_metrics`. */
export const EXTRA_COLUMN_KEYS = {
  hrHourly: "hr_hourly",
  sleep: "sleep",
  sleepStages: "sleep_stages",
} as const;

const SHORT_LABELS: Record<MetricName, string> = {
  steps: "Steps",
  distance_m: "Distance",
  flights: "Flights",
  active_kcal: "Active kcal",
  resting_kcal: "Resting kcal",
  exercise_min: "Exercise",
  stand_min: "Stand",
  daylight_min: "Daylight",
  mindful_min: "Mindful",
  resting_hr: "Resting HR",
  walking_hr_avg: "Walking HR",
  hrv_sdnn_ms: "HRV",
  vo2max: "VO2 max",
  spo2_pct: "SpO2",
  resp_rate: "Resp rate",
  wrist_temp_c: "Wrist temp",
  weight_kg: "Weight",
  body_fat_pct: "Body fat",
};

const EXTRA_COLUMNS: CoverageColumn[] = [
  { key: EXTRA_COLUMN_KEYS.hrHourly, label: "Hourly heart rate", short: "HR hourly", group: "heart" },
  { key: EXTRA_COLUMN_KEYS.sleep, label: "Sleep", short: "Sleep", group: "sleep" },
  { key: EXTRA_COLUMN_KEYS.sleepStages, label: "Sleep stages", short: "Stages", group: "sleep" },
];

/** All columns, ordered by group (metrics first within their group, extras last). */
export const COVERAGE_COLUMNS: readonly CoverageColumn[] = COVERAGE_GROUPS.flatMap((g) => [
  ...METRIC_FIELDS.filter((f) => f.category === g.id).map(
    (f): CoverageColumn => ({ key: f.name, label: f.label, short: SHORT_LABELS[f.name], group: g.id }),
  ),
  ...EXTRA_COLUMNS.filter((c) => c.group === g.id),
]);
