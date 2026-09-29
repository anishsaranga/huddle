import { describe, expect, it } from "vitest";
import { boardNav, groupQuery, groupToday, isSyncedToday, parseGroupState, weekRangeLabel } from "@/lib/groups/view";

const TODAY = "2026-09-29"; // a Tuesday

describe("groupToday", () => {
  it("averages each score over members with a value and counts synced members", () => {
    const t = groupToday([
      { scores: { recovery: 80, strain: 10.2, sleep: null }, syncedToday: true },
      { scores: { recovery: 61, strain: null, sleep: 90 }, syncedToday: false },
      { scores: { recovery: null, strain: 4.1, sleep: 70 }, syncedToday: true },
    ]);
    expect(t).toEqual({
      recovery: { value: 70.5, n: 2 },
      strain: { value: 7.2, n: 2 }, // 7.15 -> 7.2
      sleep: { value: 80, n: 2 },
      synced: 2,
      total: 3,
    });
  });

  it("is empty for nobody / no data", () => {
    expect(groupToday([])).toEqual({
      recovery: { value: null, n: 0 },
      strain: { value: null, n: 0 },
      sleep: { value: null, n: 0 },
      synced: 0,
      total: 0,
    });
  });
});

describe("isSyncedToday", () => {
  const now = new Date("2026-09-29T21:30:00Z");
  it("compares local dates in the member's timezone", () => {
    const sync = new Date("2026-09-29T11:00:00Z");
    expect(isSyncedToday(sync, "America/New_York", now)).toBe(true); // both Sep 29 in NY
    expect(isSyncedToday(sync, "Asia/Kolkata", now)).toBe(false); // now is Sep 30 03:00 in Kolkata
    // Just after local midnight in Kolkata: synced "today".
    expect(isSyncedToday(new Date("2026-09-29T18:45:00Z"), "Asia/Kolkata", now)).toBe(true);
  });
  it("never synced (or a clock in the future) is false", () => {
    expect(isSyncedToday(null, "UTC", now)).toBe(false);
    expect(isSyncedToday(new Date("2026-09-29T23:00:00Z"), "UTC", now)).toBe(false);
  });
});

describe("parseGroupState / groupQuery", () => {
  it("defaults to Info, Day, today", () => {
    expect(parseGroupState({}, TODAY, "2026-07-01")).toEqual({ tab: "info", period: "day", date: TODAY });
    expect(parseGroupState({ tab: "nope", period: "month", date: "junk" }, TODAY, null)).toEqual({
      tab: "info",
      period: "day",
      date: TODAY,
    });
  });

  it("reads tab, period and date (first of repeated params), clamping the date", () => {
    expect(parseGroupState({ tab: "strain", period: "week", date: "2026-09-22" }, TODAY, "2026-07-01")).toEqual({
      tab: "strain",
      period: "week",
      date: "2026-09-22",
    });
    expect(parseGroupState({ tab: ["sleep", "info"], date: "2026-12-01" }, TODAY, null).date).toBe(TODAY);
    expect(parseGroupState({ date: "2026-02-30" }, TODAY, null).date).toBe(TODAY);
    expect(parseGroupState({ date: "2026-01-01" }, TODAY, "2026-07-01").date).toBe("2026-07-01");
  });

  it("builds canonical URLs that omit defaults", () => {
    expect(groupQuery({ tab: "info", period: "day", date: TODAY }, TODAY)).toBe("");
    expect(groupQuery({ tab: "strain", period: "day", date: TODAY }, TODAY)).toBe("?tab=strain");
    expect(groupQuery({ tab: "recovery", period: "week", date: "2026-09-22" }, TODAY)).toBe(
      "?tab=recovery&period=week&date=2026-09-22",
    );
  });
});

describe("boardNav", () => {
  it("day: TODAY with only ‹, older days step both ways, first data date stops ‹", () => {
    expect(boardNav("day", TODAY, TODAY, "2026-09-01")).toEqual({
      title: "TODAY",
      sub: "TUE · SEP 29",
      prev: "2026-09-28",
      next: null,
    });
    expect(boardNav("day", "2026-09-28", TODAY, "2026-09-01")).toMatchObject({ title: "YESTERDAY", prev: "2026-09-27", next: TODAY });
    expect(boardNav("day", "2026-09-01", TODAY, "2026-09-01").prev).toBeNull();
    expect(boardNav("day", TODAY, TODAY, null).prev).toBeNull();
  });

  it("week: THIS WEEK / LAST WEEK / a range, stepping 7 days and clamping to today", () => {
    expect(boardNav("week", TODAY, TODAY, "2026-07-01")).toEqual({
      title: "THIS WEEK",
      sub: "SEP 28 – OCT 4",
      prev: "2026-09-22",
      next: null,
    });
    // Last week, viewed from its Saturday: next lands on today (clamped), not next Saturday.
    expect(boardNav("week", "2026-09-26", TODAY, "2026-07-01")).toEqual({
      title: "LAST WEEK",
      sub: "SEP 21 – SEP 27",
      prev: "2026-09-19",
      next: TODAY,
    });
    expect(boardNav("week", "2026-09-10", TODAY, "2026-07-01").title).toBe("SEP 7 – 13");
    expect(boardNav("week", "2026-08-30", TODAY, "2026-07-01").title).toBe("AUG 24 – 30");
    expect(boardNav("week", "2026-09-02", TODAY, "2026-07-01").title).toBe("AUG 31 – SEP 6");
    // The week holding the first data date has no ‹.
    expect(boardNav("week", "2026-07-02", TODAY, "2026-07-01").prev).toBeNull();
  });

  it("formats a week range", () => {
    expect(weekRangeLabel("2026-09-22", "2026-09-28")).toBe("SEP 22 – SEP 28");
  });
});
