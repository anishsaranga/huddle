import { describe, expect, it } from "vitest";
import {
  addDays,
  daysBetween,
  isRealDate,
  localDateOf,
  localHourOf,
  parseLocalDate,
  parseTimestamp,
  todayIn,
  zonedTimeToUtc,
} from "@/lib/tz";

describe("dates", () => {
  it("isRealDate", () => {
    expect(isRealDate("2026-09-28")).toBe(true);
    expect(isRealDate("2028-02-29")).toBe(true);
    expect(isRealDate("2026-02-29")).toBe(false);
    expect(isRealDate("2026-13-01")).toBe(false);
    expect(isRealDate("2026-9-28")).toBe(false);
    expect(isRealDate("2026-09-28T00:00:00Z")).toBe(false);
    expect(isRealDate("")).toBe(false);
  });

  it("addDays / daysBetween", () => {
    expect(addDays("2026-09-28", 1)).toBe("2026-09-29");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-09-28", -400)).toBe("2025-08-24");
    expect(daysBetween("2026-09-28", "2026-10-02")).toBe(4);
  });

  it("local dates and hours across timezones", () => {
    const t = Date.parse("2026-09-29T12:00:00Z");
    expect(localDateOf(t, "Pacific/Kiritimati")).toBe("2026-09-30"); // UTC+14
    expect(localDateOf(t, "Pacific/Pago_Pago")).toBe("2026-09-29"); // UTC-11
    expect(localHourOf(t, "Pacific/Kiritimati")).toBe(2);
    expect(localHourOf(t, "Pacific/Pago_Pago")).toBe(1);
    expect(localHourOf(Date.parse("2026-09-28T22:00:00Z"), "UTC")).toBe(22);
    expect(todayIn("Asia/Kolkata", new Date("2026-09-28T19:00:00Z"))).toBe("2026-09-29");
  });

  it("zonedTimeToUtc handles DST gaps and overlaps", () => {
    expect(zonedTimeToUtc(2026, 9, 28, 23, 42, 0, 0, "Europe/Berlin")).toBe(Date.parse("2026-09-28T21:42:00Z"));
    // 02:30 on Mar 29 2026 doesn't exist in Berlin: resolves to a real instant an hour off.
    const gap = zonedTimeToUtc(2026, 3, 29, 2, 30, 0, 0, "Europe/Berlin");
    expect([Date.parse("2026-03-29T00:30:00Z"), Date.parse("2026-03-29T01:30:00Z")]).toContain(gap);
    // 02:30 on Oct 25 2026 happens twice: one of them.
    const overlap = zonedTimeToUtc(2026, 10, 25, 2, 30, 0, 0, "Europe/Berlin");
    expect([Date.parse("2026-10-25T00:30:00Z"), Date.parse("2026-10-25T01:30:00Z")]).toContain(overlap);
  });
});

describe("parseTimestamp", () => {
  const TZ = "America/Los_Angeles"; // PDT (-07:00) in September
  const expected = Date.parse("2026-09-28T23:42:00-07:00");

  it.each([
    ["2026-09-29T06:42:00Z", expected],
    ["2026-09-29T06:42:00.000Z", expected],
    ["2026-09-28T23:42:00-07:00", expected],
    ["2026-09-28T23:42-07:00", expected],
    ["2026-09-28T23:42:00-0700", expected],
    ["2026-09-29T08:42:00+02:00", expected],
    ["2026-09-28 23:42:00 -07:00", expected],
    // Wall-clock forms use the user's timezone.
    ["2026-09-28T23:42:00", expected],
    ["Sep 28, 2026 at 11:42 PM", expected],
    ["Sep 28, 2026 at 11:42 PM", expected],
    ["September 28, 2026 at 11:42:00 PM", expected],
    ["Sept 28, 2026, 11:42 pm", expected],
    ["Sep 28, 2026 at 23:42", expected],
    ["28 Sep 2026 at 23:42", expected],
    ["28 September 2026 at 11:42 PM", expected],
  ])("%s", (input, want) => {
    expect(parseTimestamp(input, TZ)).toBe(want);
  });

  it("12 AM / 12 PM", () => {
    expect(parseTimestamp("Sep 28, 2026 at 12:05 AM", "UTC")).toBe(Date.parse("2026-09-28T00:05:00Z"));
    expect(parseTimestamp("Sep 28, 2026 at 12:05 PM", "UTC")).toBe(Date.parse("2026-09-28T12:05:00Z"));
  });

  it.each([
    "",
    "yesterday",
    "2026-09-28",
    "2026-02-30T10:00:00Z",
    "2026-09-28T25:00:00Z",
    "2026-09-28T23:42:00+15:00",
    "Foo 28, 2026 at 11:42 PM",
    "Sep 28, 2026 at 13:42 PM",
    "Sep 31, 2026 at 11:42 PM",
    "1790000000",
  ])("rejects %j", (input) => {
    expect(parseTimestamp(input, TZ)).toBeNull();
  });
});

describe("parseLocalDate", () => {
  it.each([
    ["2026-09-28", "2026-09-28"],
    [" 2026-09-28 ", "2026-09-28"],
    ["Sep 28, 2026", "2026-09-28"],
    ["September 8 2026", "2026-09-08"],
    ["28 Sep 2026", "2026-09-28"],
    ["28 Sept. 2026", "2026-09-28"],
  ])("%j -> %j", (input, want) => {
    expect(parseLocalDate(input)).toBe(want);
  });

  it.each(["2026-02-30", "Sep 31, 2026", "Foo 28, 2026", "constructor 28, 2026", "Sep 28, 2026 at 12:00 AM", "yesterday"])(
    "rejects %j",
    (input) => {
      expect(parseLocalDate(input)).toBeNull();
    },
  );
});
