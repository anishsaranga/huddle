import { describe, expect, it } from "vitest";
import { priorDates, robustBaseline, SD_FLOOR, windowValues } from "@/lib/scores/baseline";
import { circularDiff, circularMean, quantileSorted, ramp, renormalize, smoothstep, wrapMinutes } from "@/lib/scores/math";

describe("robustBaseline", () => {
  it("needs at least 4 valid values (nulls and NaN don't count)", () => {
    expect(robustBaseline([60, 61, 62])).toBeNull();
    expect(robustBaseline([60, 61, null, NaN, undefined, 62])).toBeNull();
    expect(robustBaseline([60, 61, 62, 63])).toMatchObject({ n: 4, mean: 61.5 });
  });

  it("is plain mean / sample SD for well-behaved data", () => {
    const b = robustBaseline([50, 52, 54, 56, 58, 60, 62, 64, 66, 68])!;
    expect(b.mean).toBeCloseTo(59, 0);
    expect(b.sd).toBeGreaterThan(5);
    expect(b.sd).toBeLessThan(6.5);
  });

  it("one odd day doesn't dominate", () => {
    const normal = [55, 56, 54, 55, 57, 56, 55, 54, 56, 55, 57, 56, 55, 54, 56];
    const plain = robustBaseline(normal, SD_FLOOR.resting_hr)!;
    const withSpike = robustBaseline([...normal, 95], SD_FLOOR.resting_hr)!;
    expect(withSpike.mean - plain.mean).toBeLessThan(0.6);
    expect(withSpike.sd).toBeLessThan(2.5);
    // A naive mean/SD would move a lot.
    const naiveMean = [...normal, 95].reduce((a, b) => a + b, 0) / 16;
    expect(naiveMean - plain.mean).toBeGreaterThan(2);
  });

  it("clips an outlier even with only 4 values", () => {
    const b = robustBaseline([52, 53, 54, 80], SD_FLOOR.resting_hr)!;
    expect(b.mean).toBeLessThan(56);
  });

  it("floors the SD at the metric minimum", () => {
    expect(robustBaseline([60, 60, 60, 60, 60], SD_FLOOR.resting_hr)!.sd).toBe(1.5);
    expect(robustBaseline([50, 50.5, 50, 50.5], SD_FLOOR.hrv_sdnn_ms)!.sd).toBe(4);
    expect(robustBaseline([14.5, 14.6, 14.5, 14.6], SD_FLOOR.resp_rate)!.sd).toBe(0.4);
    expect(robustBaseline([90, 91, 90, 91], SD_FLOOR.sleep_score)!.sd).toBe(5);
  });
});

describe("baseline windows", () => {
  it("covers D-30..D-1, oldest first, never D itself", () => {
    const w = priorDates("2026-03-01");
    expect(w).toHaveLength(30);
    expect(w[0]).toBe("2026-01-30");
    expect(w.at(-1)).toBe("2026-02-28");
    expect(w).not.toContain("2026-03-01");
  });

  it("keeps nulls for missing days", () => {
    const m = new Map([
      ["2026-02-28", { v: 5 }],
      ["2026-02-27", { v: null }],
      ["2026-03-01", { v: 99 }],
    ]);
    const vals = windowValues(m, "2026-03-01", (r) => r.v);
    expect(vals).toHaveLength(30);
    expect(vals.at(-1)).toBe(5);
    expect(vals.filter((v) => v !== null)).toEqual([5]);
  });
});

describe("math helpers", () => {
  it("ramp and smoothstep", () => {
    expect(ramp(0.5, 0, 1)).toBe(0.5);
    expect(ramp(-1, 0, 1)).toBe(0);
    expect(ramp(2, 0, 1)).toBe(1);
    expect(ramp(10, 15, 120)).toBe(0);
    expect(smoothstep(0)).toBe(0);
    expect(smoothstep(1)).toBe(1);
    expect(smoothstep(0.5)).toBe(0.5);
  });

  it("quantiles interpolate", () => {
    expect(quantileSorted([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(quantileSorted([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantileSorted([0, 10], 0.95)).toBeCloseTo(9.5);
  });

  it("renormalized weights sum to 1 over the present keys", () => {
    const w = renormalize({ a: 50, b: 15, c: 20, d: 15 }, { a: true, b: false, c: true, d: false });
    expect(w.b).toBe(0);
    expect(w.d).toBe(0);
    expect(w.a + w.c).toBeCloseTo(1, 12);
    expect(w.a / w.c).toBeCloseTo(2.5, 12);
    expect(Object.values(renormalize({ a: 1, b: 1 }, { a: false, b: false }))).toEqual([0, 0]);
  });

  it("circular clock math works across midnight", () => {
    expect(wrapMinutes(-30)).toBe(1410);
    expect(wrapMinutes(1450)).toBe(10);
    expect(circularDiff(23 * 60 + 50, 10)).toBe(20);
    expect(circularDiff(10, 23 * 60 + 50)).toBe(20);
    expect(circularDiff(0, 720)).toBe(720);
    // 23:00, 23:30, 00:00, 00:30 -> 23:45 (not noon)
    expect(circularMean([1380, 1410, 0, 30])).toBeCloseTo(1425, 6);
    expect(circularMean([0, 720])).toBeNull();
    expect(circularMean([])).toBeNull();
  });
});
