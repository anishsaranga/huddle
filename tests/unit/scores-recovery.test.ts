import { describe, expect, it } from "vitest";
import {
  HRV_SCALE,
  partialShrink,
  recoveryBand,
  recoveryFromZ,
  recoveryWeights,
  scoreRecovery,
  Z0,
  type RecoveryHistory,
  type RecoveryValues,
} from "@/lib/scores/recovery";

/** 30 days of a steady, slightly noisy baseline. */
const series = (mean: number, spread: number, n = 30) =>
  Array.from({ length: n }, (_, i) => mean + spread * Math.sin(i * 1.7) * 1.2);

const watchHistory: RecoveryHistory = {
  rhr: series(55, 1.5),
  hrv: series(60, 8),
  resp: series(14.6, 0.5),
  sleep: series(85, 6),
};
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const today = (o: Partial<RecoveryValues>): RecoveryValues => ({ rhr: null, hrv: null, resp: null, sleep: null, ...o });

describe("mapping and bands", () => {
  it("an average day (z = 0) reads 58", () => {
    expect(recoveryFromZ(0)).toBe(58);
    expect(Z0).toBeCloseTo(Math.log(0.58 / 0.42) / 1.6, 12);
  });

  it("is monotonic and clamped to 1..99", () => {
    expect(recoveryFromZ(1)).toBe(87);
    expect(recoveryFromZ(-1)).toBe(22);
    expect(recoveryFromZ(0.5)).toBe(75);
    expect(recoveryFromZ(-0.5)).toBe(38);
    expect(recoveryFromZ(10)).toBe(99);
    expect(recoveryFromZ(-10)).toBe(1);
    for (let z = -3; z < 3; z += 0.1) expect(recoveryFromZ(z + 0.1)).toBeGreaterThanOrEqual(recoveryFromZ(z));
  });

  it("bands: green >= 67, yellow 34-66, red <= 33", () => {
    expect(recoveryBand(67)).toBe("green");
    expect(recoveryBand(99)).toBe("green");
    expect(recoveryBand(66)).toBe("yellow");
    expect(recoveryBand(34)).toBe("yellow");
    expect(recoveryBand(33)).toBe("red");
    expect(recoveryBand(1)).toBe("red");
  });
});

describe("weights", () => {
  it("base 45/40/15 without HRV", () => {
    const w = recoveryWeights({ rhr: true, sleep: true, resp: true, hrv: false });
    expect(w).toEqual({ rhr: 0.45, sleep: 0.4, resp: 0.15, hrv: 0 });
  });

  it("HRV takes 30 and the rest shrink by 0.7", () => {
    const w = recoveryWeights({ rhr: true, sleep: true, resp: true, hrv: true });
    expect(w.hrv).toBeCloseTo(0.3, 12);
    expect(w.rhr).toBeCloseTo(0.45 * HRV_SCALE, 12);
    expect(w.sleep).toBeCloseTo(0.28, 12);
    expect(w.resp).toBeCloseTo(0.105, 12);
  });

  it("always sums to 1 over whatever is present", () => {
    const keys = ["rhr", "hrv", "resp", "sleep"] as const;
    for (let mask = 1; mask < 16; mask++) {
      const present = Object.fromEntries(keys.map((k, i) => [k, Boolean(mask & (1 << i))])) as Record<(typeof keys)[number], boolean>;
      const w = recoveryWeights(present);
      expect(sum(Object.values(w))).toBeCloseTo(1, 12);
      for (const k of keys) if (!present[k]) expect(w[k]).toBe(0);
    }
  });
});

describe("scoreRecovery by device profile", () => {
  it("Apple Watch, an ordinary morning: ~58, full data", () => {
    const r = scoreRecovery(today({ rhr: 55, hrv: 60, resp: 14.6, sleep: 85 }), watchHistory);
    expect(r.recovery).toBeGreaterThanOrEqual(55);
    expect(r.recovery).toBeLessThanOrEqual(61);
    expect(r.limited).toBe(false);
    expect(r.missing).toEqual([]);
    expect(r.contributors.map((c) => c.key)).toEqual(["rhr", "hrv", "resp", "sleep"]);
    expect(sum(r.contributors.map((c) => c.weight))).toBeCloseTo(1, 3);
    expect(r.contributors.find((c) => c.key === "rhr")).toMatchObject({ direction: "lower", n: 30 });
    expect(r.shrink).toBe(1);
    expect(r.z).toBe(r.zRaw);
    expect(r.expected).toEqual(["rhr", "hrv", "resp", "sleep"]);
    expect(sum(r.contributors.map((c) => c.impact))).toBeCloseTo(r.z!, 2);
  });

  it("Apple Watch, great morning (low RHR, high HRV, great sleep) is green; sick morning is red", () => {
    const great = scoreRecovery(today({ rhr: 51, hrv: 78, resp: 14.2, sleep: 97 }), watchHistory);
    expect(great.band).toBe("green");
    const sick = scoreRecovery(today({ rhr: 63, hrv: 38, resp: 16.4, sleep: 70 }), watchHistory);
    expect(sick.band).toBe("red");
    expect(sick.recovery!).toBeLessThan(15);
  });

  it("direction: a higher RHR lowers recovery, a higher HRV raises it", () => {
    const base = today({ rhr: 55, hrv: 60, resp: 14.6, sleep: 85 });
    const r0 = scoreRecovery(base, watchHistory).recovery!;
    expect(scoreRecovery({ ...base, rhr: 58 }, watchHistory).recovery!).toBeLessThan(r0);
    expect(scoreRecovery({ ...base, hrv: 70 }, watchHistory).recovery!).toBeGreaterThan(r0);
    expect(scoreRecovery({ ...base, resp: 15.8 }, watchHistory).recovery!).toBeLessThan(r0);
    expect(scoreRecovery({ ...base, sleep: 95 }, watchHistory).recovery!).toBeGreaterThan(r0);
  });

  it("clamps each z at +/-3 (one absurd value can't sink the day alone)", () => {
    const r = scoreRecovery(today({ rhr: 120, hrv: 60, resp: 14.6, sleep: 85 }), watchHistory);
    expect(r.contributors.find((c) => c.key === "rhr")!.z).toBe(3);
    // -3 x 0.315 = -0.945 -> ~23, not 1.
    expect(r.recovery!).toBeGreaterThan(15);
  });

  it("Fitbit (no HRV): not limited (HRV is unsupported), weights 45/40/15", () => {
    const r = scoreRecovery(today({ rhr: 55, resp: 14.6, sleep: 85 }), { ...watchHistory, hrv: [] });
    expect(r.limited).toBe(false);
    expect(r.unsupported).toEqual(["hrv"]);
    expect(r.missing).toEqual(["hrv"]);
    expect(r.contributors.map((c) => [c.key, c.weight])).toEqual([
      ["rhr", 0.45],
      ["resp", 0.15],
      ["sleep", 0.4],
    ]);
    // HRV was never in this user's baseline: no penalty.
    expect(r.shrink).toBe(1);
    expect(r.expected).toEqual(["rhr", "resp", "sleep"]);
  });

  it("Zepp (RHR + sleep only): not limited (HRV, resp unsupported), weights rescaled", () => {
    const r = scoreRecovery(today({ rhr: 55, sleep: 85 }), { ...watchHistory, hrv: [], resp: [] });
    expect(r.limited).toBe(false);
    expect(r.unsupported).toEqual(["hrv", "resp"]);
    expect(r.missing).toEqual(["hrv", "resp"]);
    expect(r.contributors.find((c) => c.key === "rhr")!.weight).toBeCloseTo(45 / 85, 4);
    expect(r.recovery).not.toBeNull();
    // Everything the device ever provides is here: no shrink.
    expect(r.shrink).toBe(1);
    expect(r.z).toBe(r.zRaw);
  });

  it("Apple Watch missing HRV today: limited, HRV is not unsupported", () => {
    const r = scoreRecovery(today({ rhr: 55, resp: 14.6, sleep: 85 }), watchHistory);
    expect(r.limited).toBe(true);
    expect(r.missing).toEqual(["hrv"]);
    expect(r.unsupported).toEqual([]);
  });

  it("RHR only (e.g. a night the watch wasn't worn): still scored, limited, and shrunk toward average", () => {
    const r = scoreRecovery(today({ rhr: 58 }), watchHistory);
    expect(r.recovery).not.toBeNull();
    expect(r.contributors).toHaveLength(1);
    expect(r.contributors[0].weight).toBe(1);
    expect(r.missing).toEqual(["hrv", "resp", "sleep"]);
    // Watch user: RHR is 31.5 of 100 base weight.
    expect(r.shrink).toBeCloseTo(Math.sqrt(0.315), 4);
    expect(r.z).toBeCloseTo(r.zRaw! * Math.sqrt(0.315), 2);
    expect(r.recovery).toBe(recoveryFromZ(r.zRaw! * r.shrink!));
    // Less extreme than the unshrunk score would have been.
    expect(r.recovery!).toBeGreaterThan(recoveryFromZ(r.zRaw!));
    expect(r.contributors[0].impact).toBeCloseTo(r.z!, 2);
  });

  it("RHR only for a user without HRV: sqrt(45 / 100) = 0.67", () => {
    const r = scoreRecovery(today({ rhr: 58 }), { ...watchHistory, hrv: [] });
    expect(r.shrink).toBeCloseTo(Math.sqrt(0.45), 4);
    expect(r.shrink).toBeCloseTo(0.67, 2);
  });

  it("partialShrink: full set = inputs with a baseline", () => {
    const all = { rhr: true, hrv: true, resp: true, sleep: true };
    const none = { rhr: false, hrv: false, resp: false, sleep: false };
    expect(partialShrink(all, all)).toBe(1);
    expect(partialShrink({ ...none, rhr: true, sleep: true }, { ...none, rhr: true, sleep: true })).toBe(1);
    expect(partialShrink({ ...none, sleep: true }, { ...none, rhr: true, sleep: true })).toBeCloseTo(Math.sqrt(40 / 85), 12);
    expect(partialShrink({ ...all, hrv: false }, all)).toBeCloseTo(Math.sqrt(0.7), 12);
  });

  it("sleep only (no RHR written today): still scored", () => {
    const r = scoreRecovery(today({ sleep: 90 }), watchHistory);
    expect(r.recovery).not.toBeNull();
    expect(r.contributors.map((c) => c.key)).toEqual(["sleep"]);
  });

  it("iPhone only (no RHR, no sleep score): null, no_data", () => {
    const r = scoreRecovery(today({}), { rhr: [], hrv: [], resp: [], sleep: [] });
    expect(r).toMatchObject({ recovery: null, band: null, reason: "no_data", limited: true });
  });

  it("an input with a value today but no baseline yet is neither limited nor unsupported", () => {
    const r = scoreRecovery(today({ rhr: 55, hrv: 60, resp: 14.6, sleep: 85 }), { ...watchHistory, hrv: [61, 59] });
    expect(r.limited).toBe(false);
    expect(r.missing).toEqual(["hrv"]);
    expect(r.unsupported).toEqual([]);
  });

  it("HRV or resp alone isn't enough", () => {
    expect(scoreRecovery(today({ hrv: 60, resp: 14 }), watchHistory).reason).toBe("no_data");
  });
});

describe("calibration phase", () => {
  it("needs 4 baseline days; reports how many are left", () => {
    const h = (n: number): RecoveryHistory => ({ rhr: series(55, 1.5, n), hrv: series(60, 8, n), resp: [], sleep: series(85, 5, n) });
    const day1 = scoreRecovery(today({ rhr: 55, hrv: 60, sleep: 85 }), h(0));
    expect(day1).toMatchObject({ recovery: null, reason: "calibrating", calibrationDaysLeft: 4 });
    expect(scoreRecovery(today({ rhr: 55, sleep: 85 }), h(1)).calibrationDaysLeft).toBe(3);
    expect(scoreRecovery(today({ rhr: 55, sleep: 85 }), h(3)).calibrationDaysLeft).toBe(1);
    const day5 = scoreRecovery(today({ rhr: 55, hrv: 60, sleep: 85 }), h(4));
    expect(day5.recovery).not.toBeNull();
    expect(day5.reason).toBeUndefined();
  });

  it("nulls in the window don't count as baseline days", () => {
    const r = scoreRecovery(today({ rhr: 55 }), { rhr: [55, null, 56, null, 54, null], hrv: [], resp: [], sleep: [] });
    expect(r).toMatchObject({ reason: "calibrating", calibrationDaysLeft: 1 });
  });

  it("an input without its own baseline counts as missing, not as calibrating", () => {
    // RHR has history; HRV just started being recorded.
    const r = scoreRecovery(today({ rhr: 55, hrv: 60, sleep: 85 }), { ...watchHistory, hrv: [61, 59] });
    expect(r.recovery).not.toBeNull();
    expect(r.missing).toContain("hrv");
    // Resp is in the user's expected set and missing today; HRV has a value, just no baseline yet.
    expect(r.limited).toBe(true);
    expect(r.unsupported).toEqual([]);
    // HRV isn't in the full set yet; only the missing resp costs anything.
    expect(r.expected).toEqual(["rhr", "resp", "sleep"]);
    expect(r.shrink).toBeCloseTo(Math.sqrt(85 / 100), 4);
  });
});
