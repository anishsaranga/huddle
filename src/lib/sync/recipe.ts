/**
 * The "Huddle Sync" Shortcut recipe data behind the /setup guide: which
 * Health type feeds which series key, in which unit, and which devices
 * actually write it (from the device table in the design spec).
 *
 * Every metric in `fields.ts` must appear here exactly once, cumulative ones
 * (summed per day) Grouped By Day and discrete ones ungrouped (the server
 * averages per day); tests/unit/sync-recipe.test.ts checks that.
 *
 * Keep this file free of path aliases and server-only imports (client code).
 */

import type { MetricName } from "../health/fields";

export type DeviceId = "apple-watch" | "fitbit" | "zepp" | "iphone" | "other";

export const DEVICES: { id: DeviceId; label: string; short: string }[] = [
  { id: "apple-watch", label: "Apple Watch", short: "Watch" },
  { id: "fitbit", label: "Fitbit", short: "Fitbit" },
  { id: "zepp", label: "Zepp / Amazfit", short: "Zepp" },
  { id: "iphone", label: "iPhone only", short: "iPhone" },
  { id: "other", label: "Other", short: "Other" },
];

/** Does the device write this type to Apple Health? */
export type Support = "yes" | "maybe" | "no";
type KnownDevice = Exclude<DeviceId, "other">;
type DeviceSupport = Record<KnownDevice, Support>;

/** What the guide tells a user with that device to do with a metric block. */
export type Advice = "include" | "optional" | "skip";

export type RecipeMetric = {
  key: MetricName;
  /** Type name in "Find Health Samples". */
  health: string;
  /** Unit to pick in "Find Health Samples". */
  unit: string;
  /** cumulative → Group By Day; discrete → no grouping. */
  kind: "cumulative" | "discrete";
  devices: DeviceSupport;
  /** Short caveat shown next to the metric. */
  note?: string;
};

const ALL: DeviceSupport = { "apple-watch": "yes", fitbit: "yes", zepp: "yes", iphone: "yes" };
const WATCH_ONLY: DeviceSupport = { "apple-watch": "yes", fitbit: "no", zepp: "no", iphone: "no" };
const WEARABLES: DeviceSupport = { "apple-watch": "yes", fitbit: "yes", zepp: "yes", iphone: "no" };

export const RECIPE_METRICS: RecipeMetric[] = [
  // Cumulative: one total per day (Group By Day).
  { key: "steps", health: "Steps", unit: "count", kind: "cumulative", devices: ALL },
  { key: "distance_m", health: "Walking + Running Distance", unit: "m", kind: "cumulative", devices: ALL },
  { key: "flights", health: "Flights Climbed", unit: "count", kind: "cumulative", devices: ALL, note: "Counted by the iPhone itself" },
  { key: "active_kcal", health: "Active Energy", unit: "kcal", kind: "cumulative", devices: ALL },
  {
    key: "resting_kcal",
    health: "Resting Energy",
    unit: "kcal",
    kind: "cumulative",
    devices: { "apple-watch": "yes", fitbit: "maybe", zepp: "maybe", iphone: "no" },
  },
  { key: "exercise_min", health: "Exercise Minutes", unit: "min", kind: "cumulative", devices: WATCH_ONLY },
  { key: "stand_min", health: "Stand Minutes", unit: "min", kind: "cumulative", devices: WATCH_ONLY },
  { key: "daylight_min", health: "Time in Daylight", unit: "min", kind: "cumulative", devices: WATCH_ONLY, note: "watchOS 10+" },
  {
    key: "mindful_min",
    health: "Mindful Minutes",
    unit: "min",
    kind: "cumulative",
    devices: { "apple-watch": "maybe", fitbit: "maybe", zepp: "maybe", iphone: "maybe" },
    note: "Only if you use a mindfulness app",
  },
  // Discrete: every sample (no grouping); the server averages each day.
  { key: "resting_hr", health: "Resting Heart Rate", unit: "count/min", kind: "discrete", devices: WEARABLES },
  { key: "walking_hr_avg", health: "Walking Heart Rate Average", unit: "count/min", kind: "discrete", devices: WATCH_ONLY },
  {
    key: "hrv_sdnn_ms",
    health: "Heart Rate Variability",
    unit: "ms",
    kind: "discrete",
    devices: { "apple-watch": "yes", fitbit: "no", zepp: "maybe", iphone: "no" },
    note: "Fitbit doesn’t share it; Zepp only from the Helio Strap",
  },
  {
    key: "vo2max",
    health: "VO2 Max",
    unit: "mL/(kg·min)",
    kind: "discrete",
    devices: { "apple-watch": "yes", fitbit: "maybe", zepp: "no", iphone: "no" },
  },
  { key: "spo2_pct", health: "Oxygen Saturation", unit: "%", kind: "discrete", devices: WEARABLES },
  {
    key: "resp_rate",
    health: "Respiratory Rate",
    unit: "count/min",
    kind: "discrete",
    devices: { "apple-watch": "yes", fitbit: "yes", zepp: "maybe", iphone: "no" },
  },
  {
    key: "wrist_temp_c",
    health: "Sleeping Wrist Temperature",
    unit: "°C",
    kind: "discrete",
    devices: WATCH_ONLY,
    note: "Series 8 / Ultra and later",
  },
  {
    key: "weight_kg",
    health: "Weight",
    unit: "kg",
    kind: "discrete",
    devices: { "apple-watch": "maybe", fitbit: "maybe", zepp: "yes", iphone: "maybe" },
    note: "From a smart scale or manual entries",
  },
  {
    key: "body_fat_pct",
    health: "Body Fat Percentage",
    unit: "%",
    kind: "discrete",
    devices: { "apple-watch": "maybe", fitbit: "maybe", zepp: "maybe", iphone: "maybe" },
    note: "From a smart scale",
  },
];

/** Hourly heart rate and sleep (their own steps in the guide). */
export const RECIPE_EXTRAS: { key: "hr" | "sleep"; health: string; devices: DeviceSupport; note?: string }[] = [
  { key: "hr", health: "Heart Rate", devices: WEARABLES },
  {
    key: "sleep",
    health: "Sleep Analysis",
    devices: ALL,
    note: "iPhone alone only writes “In Bed” from your Sleep schedule",
  },
];

/** Include / optional / skip for a device. "Other": keep everything (an empty block costs a second). */
export function adviceFor(devices: DeviceSupport, device: DeviceId): Advice {
  if (device === "other") return "optional";
  const s = devices[device];
  return s === "yes" ? "include" : s === "maybe" ? "optional" : "skip";
}

/** How many metric blocks a device needs (include + optional), out of all of them. */
export function blockCount(device: DeviceId): { keep: number; total: number } {
  const all = [...RECIPE_METRICS, ...RECIPE_EXTRAS];
  return { keep: all.filter((m) => adviceFor(m.devices, device) !== "skip").length, total: all.length };
}
