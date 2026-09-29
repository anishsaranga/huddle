import { describe, expect, it } from "vitest";
import {
  consistencyDeviation,
  consistencyScore,
  DEFAULT_SLEEP_NEED_MIN,
  durationScore,
  efficiencyScore,
  restorativeScore,
  scoreSleep,
} from "@/lib/scores/sleep";
import { addDays } from "@/lib/tz";
import { night } from "../support/score-fixtures";

const TZ = "Europe/Berlin";
const D = "2026-09-20";
/** Three to seven regular prior nights (23:00 -> 07:00). */
const priors = (n = 7, o: Parameters<typeof night>[1] = {}) =>
  Array.from({ length: n }, (_, i) => night(addDays(D, -(n - i)), { tz: TZ, ...o }));

const sum = (w: Record<string, number>) => Object.values(w).reduce((a, b) => a + b, 0);

describe("duration component", () => {
  it("is 100 at or above need, ~50 at 75 %, 0 at or below 40 %", () => {
    expect(durationScore(480, 480)).toBe(100);
    expect(durationScore(600, 480)).toBe(100);
    expect(durationScore(360, 480)).toBeCloseTo(50, 5);
    expect(durationScore(192, 480)).toBe(0);
    expect(durationScore(150, 480)).toBe(0);
  });

  it("falls smoothly and monotonically", () => {
    let prev = -1;
    for (let m = 190; m <= 490; m += 5) {
      const s = durationScore(m, 480);
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
    // Flat near the top: losing the first 5 % costs little, the next 20 % a lot.
    expect(100 - durationScore(456, 480)).toBeLessThan(4);
    expect(durationScore(432, 480)).toBeGreaterThan(85); // 90 %
    expect(durationScore(408, 480)).toBeGreaterThan(70); // 85 %
    expect(durationScore(288, 480)).toBeLessThan(20); // 60 %
  });
});

describe("efficiency, restorative, consistency components", () => {
  it("efficiency: 100 at >= 92 %, 0 at <= 65 %", () => {
    expect(efficiencyScore(0.95)).toBe(100);
    expect(efficiencyScore(0.92)).toBe(100);
    expect(efficiencyScore(0.65)).toBe(0);
    expect(efficiencyScore(0.5)).toBe(0);
    expect(efficiencyScore(0.785)).toBeCloseTo(50, 5);
  });

  it("restorative: 100 at >= 40 %, 0 at <= 15 %", () => {
    expect(restorativeScore(0.45)).toBe(100);
    expect(restorativeScore(0.4)).toBe(100);
    expect(restorativeScore(0.15)).toBe(0);
    expect(restorativeScore(0.275)).toBeCloseTo(50, 5);
  });

  it("consistency: 100 at <= 15 min, 0 at >= 120 min", () => {
    expect(consistencyScore(10)).toBe(100);
    expect(consistencyScore(15)).toBe(100);
    expect(consistencyScore(120)).toBe(0);
    expect(consistencyScore(67.5)).toBeCloseTo(50, 5);
  });

  it("bedtimes across midnight are compared on the clock, not the date", () => {
    const prior = [
      night(addDays(D, -4), { bed: "23:50", wake: "07:00" }),
      night(addDays(D, -3), { bed: "00:10", wake: "07:10" }),
      night(addDays(D, -2), { bed: "23:40", wake: "06:50" }),
      night(addDays(D, -1), { bed: "00:20", wake: "07:00" }),
    ];
    // Mean bedtime ~00:00, mean wake ~07:00.
    expect(consistencyDeviation(night(D, { bed: "00:05", wake: "07:00" }), prior, TZ)!).toBeLessThan(5);
    expect(consistencyDeviation(night(D, { bed: "23:30", wake: "06:30" }), prior, TZ)!).toBeCloseTo(30, 0);
    // Two hours late on both ends.
    expect(consistencyDeviation(night(D, { bed: "02:00", wake: "09:00" }), prior, TZ)!).toBeCloseTo(120, 0);
  });

  it("needs 3 prior nights", () => {
    expect(consistencyDeviation(night(D), priors(2), TZ)).toBeNull();
    expect(consistencyDeviation(night(D), priors(3), TZ)).toBe(0);
  });
});

describe("scoreSleep by device profile", () => {
  it("Apple Watch (in bed + stages): all four components, weights 50/15/20/15", () => {
    const r = scoreSleep({ night: night(D, { asleepMin: 450, inBedMin: 480, deepMin: 70, remMin: 100 }), prior: priors(), needMin: 480, tz: TZ });
    expect(r.reason).toBeUndefined();
    expect(r.weights).toEqual({ duration: 0.5, efficiency: 0.15, restorative: 0.2, consistency: 0.15 });
    expect(r.components.efficiency).toBe(100); // 93.75 %
    expect(r.components.restorative).toBeCloseTo(100 * ((170 / 450 - 0.15) / 0.25), 0);
    expect(r.components.consistency).toBe(100);
    expect(r.efficiency).toBeCloseTo(0.938, 3);
    const expected = 0.5 * durationScore(450, 480) + 0.15 * 100 + 0.2 * r.components.restorative! + 0.15 * 100;
    expect(r.score).toBe(Math.round(expected));
  });

  it("Fitbit (stages, no in-bed samples): efficiency omitted, weights rescaled", () => {
    const r = scoreSleep({ night: night(D, { chosenSource: "Google Health", inBedMeasured: false }), prior: priors(), needMin: 450, tz: TZ });
    expect(r.components.efficiency).toBeNull();
    expect(r.efficiency).toBeNull();
    expect(r.components.restorative).not.toBeNull();
    expect(r.weights.efficiency).toBe(0);
    expect(r.weights.duration).toBeCloseTo(50 / 85, 12);
    expect(sum(r.weights)).toBeCloseTo(1, 12);
  });

  it("Zepp (asleep only, no stages): duration + consistency only", () => {
    const r = scoreSleep({
      night: night(D, { chosenSource: "Zepp", hasStages: false, inBedMeasured: false, coreMin: 0, deepMin: 0, remMin: 0 }),
      prior: priors(5),
      needMin: 450,
      tz: TZ,
    });
    expect(r.components.restorative).toBeNull();
    expect(r.components.efficiency).toBeNull();
    expect(r.weights.duration).toBeCloseTo(50 / 65, 12);
    expect(r.weights.consistency).toBeCloseTo(15 / 65, 12);
    expect(sum(r.weights)).toBeCloseTo(1, 12);
    expect(r.score).toBe(100);
  });

  it("iPhone only (in bed, nothing asleep): no score, reason in_bed_only", () => {
    const r = scoreSleep({
      night: night(D, { chosenSource: "iPhone", asleepMin: 0, awakeMin: 480, hasStages: false }),
      prior: priors(),
      needMin: 480,
      tz: TZ,
    });
    expect(r.score).toBeNull();
    expect(r.reason).toBe("in_bed_only");
    expect(r.inBedMin).toBe(480);
    expect(r.asleepMin).toBeNull();
    expect(sum(r.weights)).toBe(0);
    expect(scoreSleep({ night: night(D, { asleepMin: null }), prior: [], needMin: 480, tz: TZ }).reason).toBe("in_bed_only");
  });

  it("no night: null with reason no_data", () => {
    const r = scoreSleep({ night: undefined, prior: priors(), needMin: 480, tz: TZ });
    expect(r).toMatchObject({ score: null, reason: "no_data", asleepMin: null });
  });

  it("without 3 prior nights, consistency is left out", () => {
    const r = scoreSleep({ night: night(D), prior: priors(2), needMin: 480, tz: TZ });
    expect(r.components.consistency).toBeNull();
    expect(r.weights.consistency).toBe(0);
    expect(sum(r.weights)).toBeCloseTo(1, 12);
  });

  it("uses 480 minutes when the user has no sleep goal", () => {
    const r = scoreSleep({ night: night(D, { asleepMin: 360 }), prior: [], needMin: null, tz: TZ });
    expect(r.needMin).toBe(DEFAULT_SLEEP_NEED_MIN);
    expect(r.components.duration).toBeCloseTo(50, 0);
  });

  it("short, fragmented, irregular nights score low", () => {
    const r = scoreSleep({
      night: night(D, { bed: "02:30", wake: "07:00", asleepMin: 200, inBedMin: 270, deepMin: 15, remMin: 25 }),
      prior: priors(),
      needMin: 480,
      tz: TZ,
    });
    expect(r.components.duration).toBe(0);
    expect(r.score!).toBeLessThan(30);
  });
});
