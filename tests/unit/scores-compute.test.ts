import { describe, expect, it } from "vitest";
import { computeDay, createContext, hasInputs, sleepFor, toScoreRow } from "@/lib/scores/compute";
import { SCORE_VERSION, type ScoreInputs } from "@/lib/scores/types";
import { addDays } from "@/lib/tz";
import { demoInputs, night } from "../support/score-fixtures";

/*
 * Whole days from the demo-data generator (the four device profiles), pushed
 * through the real ingest parser/normalizer: what the tables would hold.
 */
const NOW = new Date("2026-09-29T12:00:00Z");
const FROM = "2026-07-01";
const TO = "2026-09-28";
const cache = new Map<string, ScoreInputs>();
const inputs = (p: "watch" | "fitbit" | "zepp" | "iphone") => {
  if (!cache.has(p)) cache.set(p, demoInputs(p, FROM, TO, NOW));
  return cache.get(p)!;
};

/** Every date in the last 30 days of the range, scored. */
function lastMonth(p: "watch" | "fitbit" | "zepp" | "iphone") {
  const ctx = createContext(inputs(p));
  const out = [];
  for (let d = addDays(TO, -29); d <= TO; d = addDays(d, 1)) out.push(computeDay(ctx, d));
  return out;
}

describe("device profiles over a month of demo data", () => {
  it("Apple Watch: full sleep and recovery (HRV present), strain from HR", () => {
    const days = lastMonth("watch");
    const scoredRecovery = days.filter((d) => d.recovery.recovery !== null);
    expect(scoredRecovery.length).toBeGreaterThan(25);
    // On nights the watch was worn, every input is there.
    const full = scoredRecovery.filter((d) => !d.recovery.limited);
    expect(full.length).toBeGreaterThan(20);
    for (const d of full) expect(d.recovery.contributors.map((c) => c.key)).toEqual(["rhr", "hrv", "resp", "sleep"]);
    const sleeps = days.filter((d) => d.sleep.score !== null);
    expect(sleeps.length).toBeGreaterThan(25);
    for (const d of sleeps) {
      expect(d.sleep.components.efficiency).not.toBeNull();
      expect(d.sleep.components.restorative).not.toBeNull();
    }
    for (const d of days) {
      expect(d.strain.components.basis).toBe("hr");
      expect(d.strain.strain!).toBeGreaterThan(3);
      expect(d.strain.strain!).toBeLessThan(18);
    }
  });

  it("Fitbit: staged sleep without in-bed samples (no efficiency), recovery not limited (HRV unsupported)", () => {
    const days = lastMonth("fitbit");
    const sleeps = days.filter((d) => d.sleep.score !== null);
    expect(sleeps.length).toBeGreaterThan(24);
    for (const d of sleeps) {
      expect(d.sleep.components.efficiency).toBeNull();
      expect(d.sleep.components.restorative).not.toBeNull();
    }
    const rec = days.filter((d) => d.recovery.recovery !== null);
    expect(rec.length).toBeGreaterThan(25);
    for (const d of rec) {
      // Limited only on the rare morning an input the user normally has (resp, sleep) is missing.
      const complete = ["rhr", "resp", "sleep"].every((k) => d.recovery.contributors.some((c) => c.key === k));
      expect(d.recovery.limited).toBe(!complete);
      expect(d.recovery.unsupported).toEqual(["hrv"]);
      expect(d.recovery.missing).toContain("hrv");
    }
    expect(rec.filter((d) => !d.recovery.limited).length).toBeGreaterThan(22);
    expect(rec.some((d) => d.recovery.contributors.some((c) => c.key === "resp"))).toBe(true);
  });

  it("Zepp: asleep-only sleep (duration + consistency), recovery from RHR + sleep", () => {
    const days = lastMonth("zepp");
    const sleeps = days.filter((d) => d.sleep.score !== null);
    expect(sleeps.length).toBeGreaterThan(22);
    for (const d of sleeps) {
      expect(d.sleep.components.restorative).toBeNull();
      expect(d.sleep.components.efficiency).toBeNull();
    }
    const rec = days.filter((d) => d.recovery.recovery !== null);
    expect(rec.length).toBeGreaterThan(22);
    for (const d of rec) {
      const complete = ["rhr", "sleep"].every((k) => d.recovery.contributors.some((c) => c.key === k));
      expect(d.recovery.limited).toBe(!complete);
      expect(d.recovery.unsupported).toEqual(["hrv", "resp"]);
      expect(d.recovery.contributors.map((c) => c.key).every((k) => k === "rhr" || k === "sleep")).toBe(true);
    }
    expect(rec.filter((d) => !d.recovery.limited).length).toBeGreaterThan(18);
  });

  it("iPhone only: no sleep score (in bed only), no recovery, strain from activity", () => {
    const days = lastMonth("iphone");
    for (const d of days) {
      expect(d.sleep.score).toBeNull();
      expect(["in_bed_only", "no_data"]).toContain(d.sleep.reason);
      expect(d.recovery).toMatchObject({ recovery: null, reason: "no_data" });
      expect(d.strain.components.basis).toBe("activity");
      expect(d.strain.strain!).toBeGreaterThan(3);
      expect(d.strain.strain!).toBeLessThan(12);
    }
    expect(days.filter((d) => d.sleep.reason === "in_bed_only").length).toBeGreaterThan(25);
  });

  it("recovery spreads across bands over a month (not stuck in one)", () => {
    const bands = new Set(lastMonth("watch").map((d) => d.recovery.band));
    expect(bands.size).toBeGreaterThanOrEqual(2);
  });
});

describe("calibration phase on real data", () => {
  it("the first days of history are calibrating, then recovery appears", () => {
    const full = inputs("watch");
    // Only the first 10 days exist.
    const first = FROM;
    const cut = (m: Map<string, unknown>) => new Map([...m].filter(([d]) => d <= addDays(first, 9)));
    const ctx = createContext({
      ...full,
      metrics: cut(full.metrics) as ScoreInputs["metrics"],
      hr: cut(full.hr) as ScoreInputs["hr"],
      nights: cut(full.nights) as ScoreInputs["nights"],
    });
    const r0 = computeDay(ctx, first).recovery;
    expect(r0.reason).toBe("calibrating");
    expect(r0.calibrationDaysLeft).toBe(4);
    const r2 = computeDay(ctx, addDays(first, 2)).recovery;
    expect(r2).toMatchObject({ reason: "calibrating", calibrationDaysLeft: 2 });
    const r6 = computeDay(ctx, addDays(first, 6)).recovery;
    expect(r6.recovery).not.toBeNull();
  });
});

describe("context behaviour", () => {
  it("memoizes sleep results and uses the prior 7 nights for consistency", () => {
    const ctx = createContext({
      user: { id: "u", timezone: "Europe/Berlin", dob: null, maxHr: null, sleepGoalMin: 480 },
      metrics: new Map(),
      hr: new Map(),
      nights: new Map(
        ["2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18", "2026-09-20"].map((d) => [d, night(d)]),
      ),
    });
    const a = sleepFor(ctx, "2026-09-20");
    expect(sleepFor(ctx, "2026-09-20")).toBe(a);
    expect(a.priorNights).toBe(4);
    expect(a.components.consistency).toBe(100);
    expect(hasInputs(ctx, "2026-09-19")).toBe(false);
    expect(hasInputs(ctx, "2026-09-20")).toBe(true);
  });

  it("the stored row carries the version and every component", () => {
    const ctx = createContext(inputs("watch"));
    const row = toScoreRow(computeDay(ctx, TO));
    expect(row.components.v).toBe(SCORE_VERSION);
    expect(row.sleepScore).toBe(row.components.sleep.score);
    expect(row.recovery).toBe(row.components.recovery.recovery);
    expect(row.strain).toBe(row.components.strain.strain);
    expect(JSON.parse(JSON.stringify(row.components))).toEqual(row.components);
  });

  it("is deterministic", () => {
    const a = computeDay(createContext(inputs("fitbit")), TO);
    const b = computeDay(createContext(inputs("fitbit")), TO);
    expect(a).toEqual(b);
  });
});
