/**
 * The daily health metrics Huddle stores, defined ONCE.
 *
 * Everything that deals with per-day metrics derives from this list:
 * - the `daily_metrics` table columns (src/db/schema.ts),
 * - the ingest payload validation (field names, int/float, valid ranges),
 * - the admin "Data coverage" view and the user's data export.
 *
 * Every value is stored in its canonical unit (`unit`); converting from what
 * the Shortcut sends (e.g. SpO2 as a 0-1 fraction) happens at the ingest edge.
 * `name` is both the ingest payload key and the Drizzle property; `column` is
 * the SQL column. They are identical today and kept apart only for clarity.
 *
 * Keep this file free of path aliases and server-only imports: drizzle-kit
 * loads it through src/db/schema.ts, and client components may import it.
 */

export type MetricCategory = "activity" | "heart" | "vitals" | "body";
export type MetricType = "int" | "float";
export type MetricAggregation = "sum" | "mean";

export type MetricFieldDef = {
  /** Ingest payload key and Drizzle property (snake_case). */
  readonly name: string;
  /** SQL column in `daily_metrics`. */
  readonly column: string;
  /** Canonical unit the value is stored in. */
  readonly unit: string;
  readonly type: MetricType;
  /** Inclusive valid range (in `unit`). Values outside are rejected at ingest. */
  readonly min: number;
  readonly max: number;
  /** Human label for the admin coverage view and export. */
  readonly label: string;
  readonly category: MetricCategory;
  /**
   * A percentage Health may report as a 0-1 fraction (e.g. SpO2 0.97). At
   * ingest, a value <= 1 is multiplied by 100 when the result is in range.
   */
  readonly fraction?: boolean;
  /**
   * How several values for one day combine (the `series` ingest shape, when a
   * Shortcut didn't group its samples by day): cumulative totals are summed,
   * discrete measurements averaged.
   */
  readonly aggregation: MetricAggregation;
};

export const METRIC_FIELDS = [
  // Activity
  { name: "steps", column: "steps", unit: "count", type: "int", min: 0, max: 200_000, label: "Steps", aggregation: "sum", category: "activity" },
  { name: "distance_m", column: "distance_m", unit: "m", type: "float", min: 0, max: 500_000, label: "Walking + running distance", aggregation: "sum", category: "activity" },
  { name: "flights", column: "flights", unit: "count", type: "int", min: 0, max: 2_000, label: "Flights climbed", aggregation: "sum", category: "activity" },
  { name: "active_kcal", column: "active_kcal", unit: "kcal", type: "float", min: 0, max: 15_000, label: "Active energy", aggregation: "sum", category: "activity" },
  { name: "resting_kcal", column: "resting_kcal", unit: "kcal", type: "float", min: 0, max: 10_000, label: "Resting energy", aggregation: "sum", category: "activity" },
  { name: "exercise_min", column: "exercise_min", unit: "min", type: "float", min: 0, max: 1_440, label: "Exercise minutes", aggregation: "sum", category: "activity" },
  { name: "stand_min", column: "stand_min", unit: "min", type: "float", min: 0, max: 1_440, label: "Stand minutes", aggregation: "sum", category: "activity" },
  { name: "daylight_min", column: "daylight_min", unit: "min", type: "float", min: 0, max: 1_440, label: "Time in daylight", aggregation: "sum", category: "activity" },
  { name: "mindful_min", column: "mindful_min", unit: "min", type: "float", min: 0, max: 1_440, label: "Mindful minutes", aggregation: "sum", category: "activity" },
  // Heart
  { name: "resting_hr", column: "resting_hr", unit: "bpm", type: "float", min: 20, max: 200, label: "Resting heart rate", aggregation: "mean", category: "heart" },
  { name: "walking_hr_avg", column: "walking_hr_avg", unit: "bpm", type: "float", min: 30, max: 230, label: "Walking heart rate average", aggregation: "mean", category: "heart" },
  { name: "hrv_sdnn_ms", column: "hrv_sdnn_ms", unit: "ms", type: "float", min: 1, max: 500, label: "Heart rate variability (SDNN)", aggregation: "mean", category: "heart" },
  { name: "vo2max", column: "vo2max", unit: "mL/kg/min", type: "float", min: 5, max: 100, label: "VO2 max", aggregation: "mean", category: "heart" },
  // Vitals
  { name: "spo2_pct", column: "spo2_pct", unit: "%", type: "float", min: 50, max: 100, label: "Blood oxygen", aggregation: "mean", category: "vitals", fraction: true },
  { name: "resp_rate", column: "resp_rate", unit: "breaths/min", type: "float", min: 4, max: 60, label: "Respiratory rate", aggregation: "mean", category: "vitals" },
  { name: "wrist_temp_c", column: "wrist_temp_c", unit: "°C", type: "float", min: 25, max: 45, label: "Sleeping wrist temperature", aggregation: "mean", category: "vitals" },
  // Body
  { name: "weight_kg", column: "weight_kg", unit: "kg", type: "float", min: 20, max: 400, label: "Weight", aggregation: "mean", category: "body" },
  { name: "body_fat_pct", column: "body_fat_pct", unit: "%", type: "float", min: 1, max: 80, label: "Body fat", aggregation: "mean", category: "body", fraction: true },
] as const satisfies readonly MetricFieldDef[];

export type MetricField = (typeof METRIC_FIELDS)[number];
export type MetricName = MetricField["name"];
export type IntMetricName = Extract<MetricField, { type: "int" }>["name"];
export type FloatMetricName = Extract<MetricField, { type: "float" }>["name"];

/** A day's metric values as stored (null = no value). */
export type MetricValues = { [K in MetricName]: number | null };

export const METRIC_NAMES: readonly MetricName[] = METRIC_FIELDS.map((f) => f.name);

const BY_NAME = new Map<string, MetricField>(METRIC_FIELDS.map((f) => [f.name, f]));

export function isMetricName(name: string): name is MetricName {
  return BY_NAME.has(name);
}

export function getMetricField(name: MetricName): MetricField {
  return BY_NAME.get(name)!;
}

export const METRIC_CATEGORIES: readonly MetricCategory[] = ["activity", "heart", "vitals", "body"];

/** Is `value` acceptable for `field` (type and range)? Non-finite numbers never are. */
export function isValidMetricValue(field: MetricFieldDef, value: number): boolean {
  if (!Number.isFinite(value)) return false;
  if (field.type === "int" && !Number.isInteger(value)) return false;
  return value >= field.min && value <= field.max;
}
