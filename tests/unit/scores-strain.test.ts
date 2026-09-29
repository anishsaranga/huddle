import { describe, expect, it } from "vitest";
import {
  ageOn,
  hourLoad,
  hourZones,
  resolveMaxHr,
  resolveRhr,
  scoreStrain,
  strainFromLoad,
  type StrainInput,
} from "@/lib/scores/strain";
import type { HourRow } from "@/lib/scores/types";

/*
 * Calibration fixtures (documented in src/lib/scores/strain.ts): RHR 60,
 * max HR 190, so HRR = 130 bpm and a fraction f of HRR is 60 + 130 f bpm.
 * Each hour is [avg %HRR, max %HRR]; 8 sleeping hours sit at RHR.
 */
const RHR = 60;
const MAX = 190;
const bpm = (f: number) => Math.round(RHR + f * (MAX - RHR));
type H = [avg: number, peak: number];
const rep = (n: number, h: H): H[] => Array.from({ length: n }, () => h);

function day(hours: H[]): HourRow[] {
  return hours.map(([a, p], hour) => ({ hour, avg: bpm(a), max: bpm(p), min: Math.max(40, bpm(a) - 8) }));
}

const SLEEP = rep(8, [0, 0.12]);
const FIXTURES = {
  // ~3k steps, no exercise, awake at ~RHR+10.
  sedentary: { hours: [...SLEEP, ...rep(16, [0.077, 0.3])], kcal: 130, ex: 0, steps: 3000, range: [4, 6] },
  // An ordinary day on your feet: 9k steps, 20 min brisk walk, awake at RHR+18..24.
  typical: { hours: [...rep(8, [0.02, 0.12]), ...rep(9, [0.18, 0.35]), ...rep(7, [0.14, 0.33])], kcal: 420, ex: 20, steps: 9000, range: [7, 9] },
  // 45 min run at 60-70 % HRR, split over two clock hours (hourly means 40 / 28 %).
  moderate: { hours: [...SLEEP, ...rep(14, [0.1, 0.3]), [0.4, 0.72], [0.28, 0.7]], kcal: 480, ex: 45, steps: 9000, range: [9, 11] },
  // 90 min intervals with peaks > 85 % HRR.
  hard: { hours: [...SLEEP, ...rep(13, [0.1, 0.3]), [0.3, 0.6], [0.72, 0.92], [0.55, 0.88]], kcal: 950, ex: 90, steps: 12000, range: [15, 17] },
  // 3.5 h endurance ride.
  extreme: {
    hours: [...SLEEP, ...rep(11, [0.1, 0.3]), [0.35, 0.65], [0.66, 0.84], [0.68, 0.86], [0.66, 0.85], [0.55, 0.8]],
    kcal: 2100,
    ex: 210,
    steps: 8000,
    range: [18, 20],
  },
} as const;

const input = (f: (typeof FIXTURES)[keyof typeof FIXTURES], o: Partial<StrainInput> = {}): StrainInput => ({
  date: "2026-09-20",
  hours: day(f.hours as unknown as H[]),
  metrics: { resting_hr: RHR, active_kcal: f.kcal, exercise_min: f.ex, steps: f.steps },
  user: { maxHr: MAX, dob: null },
  baselineRhr: null,
  ...o,
});

describe("calibration targets", () => {
  it.each(Object.entries(FIXTURES))("%s lands in its target range", (_name, f) => {
    const r = scoreStrain(input(f));
    expect(r.strain!).toBeGreaterThanOrEqual(f.range[0]);
    expect(r.strain!).toBeLessThanOrEqual(f.range[1]);
    expect(r.components.basis).toBe("hr");
  });

  it("orders the days sensibly", () => {
    const s = Object.values(FIXTURES).map((f) => scoreStrain(input(f)).strain!);
    for (let i = 1; i < s.length; i++) expect(s[i]).toBeGreaterThan(s[i - 1]);
  });

  it("activity-only days (no HR at all) stay in a sensible order and range", () => {
    const s = Object.fromEntries(Object.entries(FIXTURES).map(([k, f]) => [k, scoreStrain(input(f, { hours: [] }))]));
    expect(s.sedentary.components.basis).toBe("activity");
    expect(s.sedentary.strain!).toBeGreaterThanOrEqual(4);
    expect(s.sedentary.strain!).toBeLessThanOrEqual(6);
    expect(s.moderate.strain!).toBeGreaterThanOrEqual(9);
    expect(s.moderate.strain!).toBeLessThanOrEqual(11);
    expect(s.hard.strain!).toBeGreaterThan(s.moderate.strain!);
    expect(s.extreme.strain!).toBeGreaterThanOrEqual(18);
    expect(s.extreme.strain!).toBeLessThanOrEqual(20);
  });
});

describe("formula details", () => {
  it("strain curve: 0 at no load, saturating below 21", () => {
    expect(strainFromLoad(0)).toBe(0);
    expect(strainFromLoad(-5)).toBe(0);
    expect(strainFromLoad(10_000)).toBe(21);
    expect(strainFromLoad(152)).toBeCloseTo(21 * (1 - Math.exp(-1)), 1);
  });

  it("hour load: sleeping hours at or below RHR cost nothing; intensity is squared", () => {
    expect(hourLoad({ hour: 3, avg: 55, min: 50, max: 58 }, 60, 130)).toBe(0);
    const easy = hourLoad({ hour: 10, avg: bpm(0.3), min: null, max: null }, 60, 130);
    const hard = hourLoad({ hour: 10, avg: bpm(0.6), min: null, max: null }, 60, 130);
    expect(hard / easy).toBeGreaterThan(3);
  });

  it("a short hard effort inside an easy hour adds a peak bonus", () => {
    const flat = hourLoad({ hour: 10, avg: bpm(0.3), min: null, max: bpm(0.5) }, 60, 130);
    const spiky = hourLoad({ hour: 10, avg: bpm(0.3), min: null, max: bpm(0.95) }, 60, 130);
    expect(spiky - flat).toBeCloseTo(60 * 6 * (bpm(0.95) - 60 - 0.6 * 130) ** 2 / 130 ** 2, 1);
  });

  it("with HR, activity counts at 35 %", () => {
    const f = FIXTURES.moderate;
    const r = scoreStrain(input(f));
    expect(r.components.activityLoad).toBeCloseTo(f.kcal / 10 + f.ex * 0.8, 5);
    expect(r.components.load).toBeCloseTo(r.components.cardioLoad + 0.35 * r.components.activityLoad, 0);
    expect(r.components.hoursWithHr).toBe(24);
  });

  it("is null without any HR or activity data", () => {
    expect(scoreStrain(input(FIXTURES.sedentary, { hours: [], metrics: undefined })).strain).toBeNull();
    const r = scoreStrain(input(FIXTURES.sedentary, { hours: [], metrics: { resting_hr: 55, active_kcal: null, exercise_min: null, steps: null } }));
    expect(r).toMatchObject({ strain: null, reason: "no_data" });
  });

  it("steps alone give a small strain (iPhone-only user, early in the day)", () => {
    const r = scoreStrain(input(FIXTURES.sedentary, { hours: [], metrics: { resting_hr: null, active_kcal: null, exercise_min: null, steps: 600 } }));
    expect(r.strain!).toBeGreaterThan(0);
    expect(r.strain!).toBeLessThan(2);
  });
});

describe("max HR and RHR fallbacks", () => {
  it("age from dob on the date (birthday boundary)", () => {
    expect(ageOn("1990-09-20", "2026-09-19")).toBe(35);
    expect(ageOn("1990-09-20", "2026-09-20")).toBe(36);
    expect(ageOn("2000-02-29", "2026-02-28")).toBe(25);
    expect(ageOn("2000-02-29", "2026-03-01")).toBe(26);
  });

  it("profile max HR, else 208 - 0.7 x age, else 190", () => {
    expect(resolveMaxHr(185, "1990-01-01", "2026-09-20")).toEqual({ value: 185, source: "profile" });
    expect(resolveMaxHr(null, "1990-01-01", "2026-09-20")).toEqual({ value: 182.8, source: "age" });
    expect(resolveMaxHr(null, null, "2026-09-20")).toEqual({ value: 190, source: "default" });
    expect(resolveMaxHr(0, null, "2026-09-20").source).toBe("default");
  });

  it("day RHR, else baseline RHR, else 60", () => {
    expect(resolveRhr(52, 55)).toEqual({ value: 52, source: "day" });
    expect(resolveRhr(null, 55.26)).toEqual({ value: 55.3, source: "baseline" });
    expect(resolveRhr(null, null)).toEqual({ value: 60, source: "default" });
  });

  it("the fallbacks flow into the result", () => {
    const r = scoreStrain(
      input(FIXTURES.moderate, {
        user: { maxHr: null, dob: "1996-01-01" },
        metrics: { resting_hr: null, active_kcal: 480, exercise_min: 45, steps: 9000 },
        baselineRhr: 58,
      }),
    );
    expect(r.components).toMatchObject({ maxHr: 208 - 0.7 * 30, maxHrSource: "age", rhr: 58, rhrSource: "baseline" });
    // A lower max HR (older) makes the same heart rates count as harder.
    const younger = scoreStrain(input(FIXTURES.moderate, { user: { maxHr: 200, dob: null } }));
    const older = scoreStrain(input(FIXTURES.moderate, { user: { maxHr: 175, dob: null } }));
    expect(older.strain!).toBeGreaterThan(younger.strain!);
  });
});

describe("zones", () => {
  it("a steady hour lands in one zone", () => {
    const z = hourZones({ hour: 10, avg: bpm(0.65), min: null, max: null }, RHR, 130);
    expect(z).toEqual([0, 60, 0, 0, 0]);
  });

  it("never invents minutes, and puts short peaks in the top zones", () => {
    const z = hourZones({ hour: 10, avg: bpm(0.45), min: bpm(0.2), max: bpm(0.95) }, RHR, 130);
    const total = z.reduce((a, b) => a + b, 0);
    expect(total).toBeLessThanOrEqual(60 + 1e-9);
    expect(z[4]).toBeGreaterThan(0);
    expect(z[4]).toBeLessThan(z[0]);
  });

  it("an easy day has no zone minutes; a hard day has some in zones 4-5", () => {
    expect(scoreStrain(input(FIXTURES.sedentary)).zones).toEqual({ z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 });
    const hard = scoreStrain(input(FIXTURES.hard)).zones;
    expect(hard.z4 + hard.z5).toBeGreaterThan(5);
    expect(hard.z1 + hard.z2 + hard.z3 + hard.z4 + hard.z5).toBeLessThanOrEqual(180);
  });
});
