import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { dailyMetrics } from "@/db/schema";
import { isValidMetricValue, METRIC_CATEGORIES, METRIC_FIELDS } from "@/lib/health/fields";

describe("METRIC_FIELDS", () => {
  it("has unique names and columns, sane ranges and known categories", () => {
    expect(new Set(METRIC_FIELDS.map((f) => f.name)).size).toBe(METRIC_FIELDS.length);
    expect(new Set(METRIC_FIELDS.map((f) => f.column)).size).toBe(METRIC_FIELDS.length);
    for (const f of METRIC_FIELDS) {
      expect(f.min, f.name).toBeLessThan(f.max);
      expect(METRIC_CATEGORIES).toContain(f.category);
      expect(f.label.length, f.name).toBeGreaterThan(0);
      expect(f.name).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it("drives the daily_metrics columns (nullable; int -> integer, float -> real)", () => {
    const cols = new Map(getTableConfig(dailyMetrics).columns.map((c) => [c.name, c]));
    for (const f of METRIC_FIELDS) {
      const col = cols.get(f.column);
      expect(col, f.column).toBeDefined();
      expect(col!.notNull, f.column).toBe(false);
      expect(col!.getSQLType(), f.column).toBe(f.type === "int" ? "integer" : "real");
    }
    // Only the key and timestamps besides the metrics.
    expect(cols.size).toBe(METRIC_FIELDS.length + 4);
  });

  it("sums cumulative metrics and averages discrete ones (series with several values per day)", () => {
    const sums = METRIC_FIELDS.filter((f) => f.aggregation === "sum").map((f) => f.name);
    expect(sums).toEqual([
      "steps",
      "distance_m",
      "flights",
      "active_kcal",
      "resting_kcal",
      "exercise_min",
      "stand_min",
      "daylight_min",
      "mindful_min",
    ]);
    for (const f of METRIC_FIELDS) expect(["sum", "mean"], f.name).toContain(f.aggregation);
    // Fractions are converted per value before averaging; a summed fraction would make no sense.
    for (const f of METRIC_FIELDS) if ("fraction" in f && f.fraction) expect(f.aggregation, f.name).toBe("mean");
  });

  it("validates type and range", () => {
    const steps = METRIC_FIELDS.find((f) => f.name === "steps")!;
    const hr = METRIC_FIELDS.find((f) => f.name === "resting_hr")!;
    expect(isValidMetricValue(steps, 1234)).toBe(true);
    expect(isValidMetricValue(steps, 12.5)).toBe(false);
    expect(isValidMetricValue(steps, -1)).toBe(false);
    expect(isValidMetricValue(hr, 52.4)).toBe(true);
    expect(isValidMetricValue(hr, 5)).toBe(false);
    expect(isValidMetricValue(hr, Number.NaN)).toBe(false);
    expect(isValidMetricValue(hr, Number.POSITIVE_INFINITY)).toBe(false);
  });
});
