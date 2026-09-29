import { describe, expect, it } from "vitest";
import { METRIC_FIELDS } from "@/lib/health/fields";
import { adviceFor, blockCount, DEVICES, RECIPE_EXTRAS, RECIPE_METRICS } from "@/lib/sync/recipe";

describe("Shortcut recipe metrics", () => {
  it("covers every metric in fields.ts exactly once", () => {
    const keys = RECIPE_METRICS.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect([...keys].sort()).toEqual(METRIC_FIELDS.map((f) => f.name).sort());
  });

  it("groups cumulative metrics by day and leaves discrete ones ungrouped (matching the server's aggregation)", () => {
    for (const m of RECIPE_METRICS) {
      const field = METRIC_FIELDS.find((f) => f.name === m.key)!;
      expect(m.kind, m.key).toBe(field.aggregation === "sum" ? "cumulative" : "discrete");
    }
  });

  it("lists the metrics in the order of the guide's steps (cumulative first)", () => {
    const kinds = RECIPE_METRICS.map((m) => m.kind);
    expect(kinds.lastIndexOf("cumulative")).toBeLessThan(kinds.indexOf("discrete"));
  });
});

describe("device advice", () => {
  it("maps support to include / optional / skip, and keeps everything optional for Other", () => {
    const hrv = RECIPE_METRICS.find((m) => m.key === "hrv_sdnn_ms")!;
    expect(adviceFor(hrv.devices, "apple-watch")).toBe("include");
    expect(adviceFor(hrv.devices, "fitbit")).toBe("skip");
    expect(adviceFor(hrv.devices, "zepp")).toBe("optional");
    expect(adviceFor(hrv.devices, "other")).toBe("optional");
  });

  it("follows the spec's device table", () => {
    const get = (k: string) => RECIPE_METRICS.find((m) => m.key === k)!.devices;
    for (const k of ["steps", "distance_m", "active_kcal"]) {
      expect(Object.values(get(k)).every((s) => s === "yes"), k).toBe(true);
    }
    for (const d of ["apple-watch", "fitbit", "zepp"] as const) {
      expect(get("resting_hr")[d]).toBe("yes");
      expect(get("spo2_pct")[d]).toBe("yes");
    }
    expect(get("weight_kg").zepp).toBe("yes");
    expect(RECIPE_EXTRAS.find((e) => e.key === "sleep")!.devices.iphone).toBe("yes");
    expect(RECIPE_EXTRAS.find((e) => e.key === "hr")!.devices.iphone).toBe("no");
  });

  it("an Apple Watch needs every block; iPhone alone the fewest", () => {
    const total = RECIPE_METRICS.length + RECIPE_EXTRAS.length;
    expect(blockCount("apple-watch")).toEqual({ keep: total, total });
    expect(blockCount("other")).toEqual({ keep: total, total });
    const counts = DEVICES.map((d) => blockCount(d.id).keep);
    expect(Math.min(...counts)).toBe(blockCount("iphone").keep);
  });
});
