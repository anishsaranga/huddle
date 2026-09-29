import { describe, expect, it } from "vitest";
import {
  addMonths,
  currentHourFor,
  dateHref,
  dateLabel,
  dayNav,
  dayOfWeek,
  daySubtitle,
  dayTitle,
  monthGrid,
  resolveDashboardDate,
} from "@/lib/dashboard/dates";

const TODAY = "2026-09-29"; // a Tuesday

describe("resolveDashboardDate", () => {
  it("defaults to today for missing, malformed, unreal or repeated-but-bad values", () => {
    expect(resolveDashboardDate(undefined, TODAY, "2026-07-01")).toBe(TODAY);
    expect(resolveDashboardDate(null, TODAY, "2026-07-01")).toBe(TODAY);
    expect(resolveDashboardDate("", TODAY, "2026-07-01")).toBe(TODAY);
    expect(resolveDashboardDate("yesterday", TODAY, "2026-07-01")).toBe(TODAY);
    expect(resolveDashboardDate("2026-02-30", TODAY, "2026-01-01")).toBe(TODAY);
    expect(resolveDashboardDate("2026-9-28", TODAY, "2026-07-01")).toBe(TODAY);
    expect(resolveDashboardDate(["nope", "2026-09-28"], TODAY, "2026-07-01")).toBe(TODAY);
  });

  it("takes the first of repeated params", () => {
    expect(resolveDashboardDate(["2026-09-20", "2026-09-21"], TODAY, "2026-07-01")).toBe("2026-09-20");
  });

  it("keeps dates inside [first data date, today]", () => {
    expect(resolveDashboardDate("2026-09-28", TODAY, "2026-07-01")).toBe("2026-09-28");
    expect(resolveDashboardDate("2026-07-01", TODAY, "2026-07-01")).toBe("2026-07-01");
    expect(resolveDashboardDate(TODAY, TODAY, "2026-07-01")).toBe(TODAY);
  });

  it("clamps to the first data date and to today", () => {
    expect(resolveDashboardDate("2026-01-01", TODAY, "2026-07-01")).toBe("2026-07-01");
    expect(resolveDashboardDate("2027-01-01", TODAY, "2026-07-01")).toBe(TODAY);
  });

  it("without data (or data only in the future) the range is just today", () => {
    expect(resolveDashboardDate("2026-09-01", TODAY, null)).toBe(TODAY);
    expect(resolveDashboardDate("2026-09-01", TODAY, "2026-09-30")).toBe(TODAY);
  });
});

describe("dayNav", () => {
  it("stops at the first data date and at today", () => {
    expect(dayNav("2026-09-28", TODAY, "2026-07-01")).toEqual({ prev: "2026-09-27", next: TODAY });
    expect(dayNav(TODAY, TODAY, "2026-07-01")).toEqual({ prev: "2026-09-28", next: null });
    expect(dayNav("2026-07-01", TODAY, "2026-07-01")).toEqual({ prev: null, next: "2026-07-02" });
    expect(dayNav(TODAY, TODAY, null)).toEqual({ prev: null, next: null });
  });
});

describe("labels", () => {
  it("dayOfWeek", () => {
    expect(dayOfWeek("2026-09-29")).toBe(2);
    expect(dayOfWeek("2026-09-27")).toBe(0);
    expect(dayOfWeek("1970-01-01")).toBe(4);
  });

  it("dayTitle: TODAY, YESTERDAY, a weekday within the week, else a short date", () => {
    expect(dayTitle(TODAY, TODAY)).toBe("TODAY");
    expect(dayTitle("2026-09-28", TODAY)).toBe("YESTERDAY");
    expect(dayTitle("2026-09-26", TODAY)).toBe("SATURDAY");
    expect(dayTitle("2026-09-23", TODAY)).toBe("WEDNESDAY");
    expect(dayTitle("2026-09-22", TODAY)).toBe("SEP 22");
  });

  it("dateLabel adds the year only when it differs", () => {
    expect(dateLabel("2026-09-28", TODAY)).toBe("MON · SEP 28");
    expect(dateLabel("2025-12-31", TODAY)).toBe("WED · DEC 31 2025");
  });

  it("daySubtitle avoids repeating the date under a date title", () => {
    expect(daySubtitle("2026-09-28", TODAY)).toBe("MON · SEP 28");
    expect(daySubtitle("2026-09-20", TODAY)).toBe("SUNDAY");
    expect(daySubtitle("2025-09-20", TODAY)).toBe("SATURDAY · 2025");
  });

  it("dateHref keeps today's URL canonical", () => {
    expect(dateHref("/home", TODAY, TODAY)).toBe("/home");
    expect(dateHref("/sleep", "2026-09-20", TODAY)).toBe("/sleep?date=2026-09-20");
  });
});

describe("partial day", () => {
  it("currentHourFor is the local hour today and null for other days", () => {
    const now = new Date("2026-09-29T12:30:00Z");
    expect(currentHourFor(TODAY, TODAY, "Europe/Berlin", now)).toBe(14);
    expect(currentHourFor(TODAY, TODAY, "Asia/Kolkata", now)).toBe(18);
    expect(currentHourFor("2026-09-28", TODAY, "Europe/Berlin", now)).toBeNull();
  });
});

describe("calendar", () => {
  it("monthGrid is Monday-first weeks padded with null", () => {
    const g = monthGrid("2026-09");
    expect(g[0]).toEqual([null, "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06"]);
    expect(g.every((w) => w.length === 7)).toBe(true);
    expect(g.flat().filter(Boolean)).toHaveLength(30);
    expect(g.at(-1)).toEqual(["2026-09-28", "2026-09-29", "2026-09-30", null, null, null, null]);
  });

  it("addMonths wraps years", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-09", -9)).toBe("2025-12");
  });
});
