import { describe, expect, it } from "vitest";
import {
  calibrationProgress,
  limitedExplainer,
  recoveryNullReason,
  sleepComponentMissingWhy,
  sleepNullReason,
  strainNullReason,
} from "@/lib/dashboard/explain";
import { deviceName, formatClock, formatClockMinutes, formatDuration, formatHm, joinList } from "@/lib/dashboard/format";
import { hourPoints, statViews } from "@/lib/dashboard/overview-view";
import { bedtimeChart, stageBreakdown } from "@/lib/dashboard/sleep-view";
import { buildTrendSeries, recentAverage } from "@/lib/dashboard/trend";
import type { KeyStat, TrendPoint } from "@/lib/scores/queries";
import type { RecoveryResult } from "@/lib/scores/recovery";
import type { SleepResult } from "@/lib/scores/sleep";
import { addDays, zonedTimeToUtc } from "@/lib/tz";

const ALL = { hasHrv: true, hasResp: true, hasRhr: true };
const FITBIT = { hasHrv: false, hasResp: true, hasRhr: true };
const PHONE = { hasHrv: false, hasResp: false, hasRhr: false };

function recovery(p: Partial<RecoveryResult>): RecoveryResult {
  return {
    recovery: 60,
    band: "yellow",
    limited: false,
    z: 0,
    zRaw: 0,
    shrink: 1,
    expected: ["rhr", "resp", "sleep"],
    contributors: [],
    missing: [],
    ...p,
  };
}
const contributor = (key: "rhr" | "hrv" | "resp" | "sleep") => ({
  key,
  value: 1,
  baseline: 1,
  sd: 1,
  n: 10,
  z: 0,
  weight: 0.3,
  direction: "lower" as const,
  impact: 0,
});

function sleep(p: Partial<SleepResult>): SleepResult {
  return {
    score: 80,
    components: { duration: 90, efficiency: 90, restorative: 70, consistency: 80 },
    weights: { duration: 0.5, efficiency: 0.15, restorative: 0.2, consistency: 0.15 },
    needMin: 480,
    asleepMin: 440,
    inBedMin: 470,
    efficiency: 0.93,
    restorativeShare: 0.35,
    consistencyDevMin: 20,
    priorNights: 7,
    ...p,
  };
}

describe("format", () => {
  it("durations and clock times", () => {
    expect(formatHm(472)).toBe("7:52");
    expect(formatHm(59.6)).toBe("1:00");
    expect(formatDuration(125)).toBe("2h 05m");
    expect(formatDuration(42)).toBe("42m");
    const ms = zonedTimeToUtc(2026, 9, 28, 23, 42, 0, 0, "Europe/Berlin");
    expect(formatClock(ms, "Europe/Berlin", false)).toBe("23:42");
    expect(formatClock(ms, "Europe/Berlin", true)).toBe("11:42 PM");
    expect(formatClockMinutes(0, true)).toBe("12:00 AM");
    expect(formatClockMinutes(1440 + 65, false)).toBe("01:05");
  });

  it("deviceName maps Health sources to what people call their device", () => {
    expect(deviceName("Google Health")).toBe("Fitbit");
    expect(deviceName("Zepp")).toBe("Zepp");
    expect(deviceName("Lukas's Apple Watch")).toBe("Apple Watch");
    expect(deviceName("iPhone")).toBe("iPhone");
    expect(deviceName(null)).toBe("tracker");
    expect(deviceName("Withings")).toBe("Withings");
  });

  it("joinList", () => {
    expect(joinList(["a"])).toBe("a");
    expect(joinList(["a", "b"], "or")).toBe("a or b");
    expect(joinList(["a", "b", "c"])).toBe("a, b and c");
  });
});

describe("null-score reasons", () => {
  it("recovery: calibrating days, phone-only, today vs past", () => {
    expect(recoveryNullReason(recovery({}), { isToday: true, facts: ALL })).toBeNull();
    expect(
      recoveryNullReason(recovery({ recovery: null, reason: "calibrating", calibrationDaysLeft: 2 }), { isToday: true, facts: ALL }),
    ).toBe("CALIBRATING · 2 DAYS");
    expect(
      recoveryNullReason(recovery({ recovery: null, reason: "calibrating", calibrationDaysLeft: 1 }), { isToday: false, facts: ALL }),
    ).toBe("CALIBRATING · 1 DAY");
    expect(
      recoveryNullReason(recovery({ recovery: null, reason: "no_data" }), { isToday: true, facts: PHONE, sleep: sleep({ score: null, reason: "in_bed_only" }) }),
    ).toBe("NEEDS A TRACKER");
    expect(recoveryNullReason(null, { isToday: true, facts: ALL })).toBe("SYNC TO SEE");
    expect(recoveryNullReason(recovery({ recovery: null, reason: "no_data" }), { isToday: false, facts: ALL })).toBe("NO DATA");
  });

  it("sleep and strain", () => {
    expect(sleepNullReason(sleep({}), { isToday: true })).toBeNull();
    expect(sleepNullReason(sleep({ score: null, reason: "in_bed_only" }), { isToday: true })).toBe("NO SLEEP DATA");
    expect(sleepNullReason(null, { isToday: true })).toBe("SYNC TO SEE");
    expect(sleepNullReason(null, { isToday: false })).toBe("NO SLEEP DATA");
    expect(strainNullReason(null, { isToday: true })).toBe("SYNC TO SEE");
    expect(strainNullReason(null, { isToday: false })).toBe("NO DATA");
  });
});

describe("limitedExplainer", () => {
  it("names what the device never shares and what the score used", () => {
    const rec = recovery({
      limited: true,
      missing: ["hrv"],
      contributors: [contributor("rhr"), contributor("sleep"), contributor("resp")],
    });
    expect(limitedExplainer(rec, FITBIT, "Fitbit")).toBe(
      "Your Fitbit doesn't share HRV with Apple Health — recovery uses resting HR, sleep and breathing rate.",
    );
  });

  it("separates never-sent, calibrating and missing-today inputs", () => {
    const rec = recovery({
      limited: true,
      expected: ["rhr", "sleep", "hrv"],
      missing: ["hrv", "resp", "sleep"],
      contributors: [contributor("rhr")],
    });
    expect(limitedExplainer(rec, { hasHrv: true, hasResp: false, hasRhr: true }, "Zepp")).toBe(
      "Your Zepp doesn't share breathing rate with Apple Health. No HRV or sleep score for this day — recovery uses resting HR.",
    );
    const cal = recovery({ limited: true, expected: ["rhr", "sleep"], missing: ["hrv"], contributors: [contributor("rhr"), contributor("sleep")] });
    expect(limitedExplainer(cal, ALL, "Apple Watch")).toBe("HRV is still building a baseline — recovery uses resting HR and sleep.");
  });

  it("null when not limited or no score", () => {
    expect(limitedExplainer(recovery({}), ALL, "Apple Watch")).toBeNull();
    expect(limitedExplainer(recovery({ recovery: null, limited: true, missing: ["hrv"] }), ALL, "x")).toBeNull();
  });

  it("calibrationProgress", () => {
    expect(calibrationProgress(recovery({ recovery: null, reason: "calibrating", calibrationDaysLeft: 1 }))).toEqual({ done: 3, needed: 4 });
    expect(calibrationProgress(recovery({}))).toBeNull();
  });

  it("sleep component reasons", () => {
    const s = sleep({ components: { duration: 90, efficiency: null, restorative: null, consistency: null }, priorNights: 1 });
    expect(sleepComponentMissingWhy("duration", s, { device: "Zepp", hasStages: false })).toBeNull();
    expect(sleepComponentMissingWhy("efficiency", s, { device: "Zepp", hasStages: false })).toBe("Zepp didn't record time in bed");
    expect(sleepComponentMissingWhy("restorative", s, { device: "Zepp", hasStages: false })).toBe("Stages not available from Zepp");
    expect(sleepComponentMissingWhy("consistency", s, { device: "Zepp", hasStages: false })).toBe("Needs 3 nights of history (1 so far)");
  });
});

describe("key stats", () => {
  const stat = (key: KeyStat["key"], value: number | null, baseline: number | null, n = 20): KeyStat => ({
    key,
    unit: "",
    value,
    baseline,
    n,
    delta: value !== null && baseline !== null ? value - baseline : null,
    higherIsBetter: key !== "resting_hr" && key !== "resp_rate",
  });
  const stats = [
    stat("resting_hr", 52, 54),
    stat("hrv_sdnn_ms", 60, 55),
    stat("resp_rate", 14.2, 14.5),
    stat("sleep_duration", 452, 430),
    stat("steps", 4210, 9800),
    stat("active_kcal", 300, 520),
  ];

  it("today: activity is 'so far' without a delta; past days compare normally", () => {
    const today = statViews(stats, { isToday: true, facts: ALL });
    const steps = today.find((s) => s.key === "steps")!;
    expect(steps).toMatchObject({ note: "SO FAR", showDelta: false, display: "4,210", baselineDisplay: "9,800" });
    expect(today.find((s) => s.key === "sleep_duration")).toMatchObject({ display: "7:32", baselineDisplay: "7:10", showDelta: true });
    const past = statViews(stats, { isToday: false, facts: ALL });
    expect(past.find((s) => s.key === "steps")).toMatchObject({ showDelta: true });
    expect(past.find((s) => s.key === "steps")!.note).toBeUndefined();
  });

  it("vitals only when the device ever sent them; rows without any history are dropped", () => {
    const fitbit = statViews(stats, { isToday: false, facts: FITBIT }).map((s) => s.key);
    expect(fitbit).toEqual(["resting_hr", "resp_rate", "sleep_duration", "steps", "active_kcal"]);
    const phone = statViews(
      [stat("resting_hr", null, null, 0), stat("sleep_duration", null, null, 0), stat("steps", 5000, 6000), stat("active_kcal", null, 300)],
      { isToday: false, facts: PHONE },
    );
    expect(phone.map((s) => s.key)).toEqual(["steps", "active_kcal"]);
    expect(phone[1]).toMatchObject({ display: "—", showDelta: false });
  });

  it("hourPoints fills 24 slots and tolerates missing min/max", () => {
    const pts = hourPoints([
      { hour: 0, min: 50, avg: 55, max: 60 },
      { hour: 7, min: null, avg: 80, max: null },
    ]);
    expect(pts).toHaveLength(24);
    expect(pts[7]).toEqual({ hour: 7, min: 80, avg: 80, max: 80 });
    expect(pts.filter(Boolean)).toHaveLength(2);
  });
});

describe("trend series", () => {
  const end = "2026-09-29";
  const points: TrendPoint[] = Array.from({ length: 182 }, (_, i) => ({
    date: addDays(end, i - 181),
    value: i % 10 === 3 ? null : 40 + (i % 50),
  }));

  it("1W / 1M are daily, 6M is 26 weekly means ending on the date", () => {
    const s = buildTrendSeries(points, (v) => (v > 60 ? "green" : "red"));
    expect(s["1w"]).toHaveLength(7);
    expect(s["1w"].at(-1)).toMatchObject({ key: end, label: "TUE", title: "TUE · SEP 29" });
    expect(s["1m"]).toHaveLength(30);
    expect(s["1m"].filter((b) => b.label).map((b) => b.label)).toEqual(["SEP 1", "SEP 8", "SEP 15", "SEP 22", "SEP 29"]);
    expect(s["6m"]).toHaveLength(26);
    expect(s["6m"].at(-1)!.title).toBe("WEEK OF SEP 23");
    const lastWeek = points.slice(-7).map((p) => p.value).filter((v): v is number => v !== null);
    expect(s["6m"].at(-1)!.value).toBeCloseTo(lastWeek.reduce((a, b) => a + b, 0) / lastWeek.length, 1);
    expect(s["6m"].filter((b) => b.label).map((b) => b.label)).toEqual(["APR", "MAY", "JUN", "JUL", "AUG", "SEP"]);
    // Colors follow values; nulls stay uncolored.
    expect(s["1m"].find((b) => b.value === null)!.color).toBeUndefined();
    expect(s["1w"].every((b) => b.value === null || b.color === (b.value > 60 ? "green" : "red"))).toBe(true);
  });

  it("recentAverage ignores nulls and is null without values", () => {
    expect(recentAverage([{ date: "a", value: 10 }, { date: "b", value: null }, { date: "c", value: 20 }])).toBe(15);
    expect(recentAverage([{ date: "a", value: null }])).toBeNull();
  });
});

describe("sleep view", () => {
  it("stageBreakdown shares add up", () => {
    const rows = stageBreakdown({ awakeMin: 20, remMin: 100, coreMin: 260, deepMin: 70 });
    expect(rows.map((r) => r.stage)).toEqual(["awake", "rem", "core", "deep"]);
    expect(rows.reduce((a, r) => a + r.pct, 0)).toBeGreaterThanOrEqual(99);
    expect(rows[2]).toEqual({ stage: "core", minutes: 260, pct: 58 });
  });

  it("bedtimeChart places bed/wake on an evening-anchored clock axis", () => {
    const tz = "Europe/Berlin";
    const night = (wake: string, bedH: number, wakeH: number) => ({
      wakeDate: wake,
      bedStart: new Date(zonedTimeToUtc(...(addDays(wake, -1).split("-").map(Number) as [number, number, number]), bedH, 30, 0, 0, tz)),
      bedEnd: new Date(zonedTimeToUtc(...(wake.split("-").map(Number) as [number, number, number]), wakeH, 0, 0, 0, tz)),
      asleepMin: 420,
    });
    const c = bedtimeChart([night("2026-09-27", 22, 7), night("2026-09-29", 23, 6)], "2026-09-29", tz, false);
    expect(c.rows).toHaveLength(7);
    expect(c.rows.at(-1)).toMatchObject({ label: "TUE", current: true, bed: 5 * 60 + 30, wake: 12 * 60, bedLabel: "23:30", wakeLabel: "06:00" });
    expect(c.rows.at(-2)!.bed).toBeNull();
    expect(c.meanBed).toBe(5 * 60);
    expect(c.lo).toBeLessThanOrEqual(4 * 60);
    expect(c.hi).toBeGreaterThanOrEqual(14 * 60);
    expect(c.ticks.map((t) => t.label)).toContain("00");
  });
});
