import { describe, expect, it } from "vitest";
import { getMetricField } from "@/lib/health/fields";
import { dateWindow, normalizeIngest, resolveTimezone } from "@/lib/ingest/normalize";
import {
  MAX_DAYS,
  normalizeMetricValue,
  parseNumeric,
  parsePayload,
  splitColumn,
  trimTrailingBlanks,
  type ParsedPayload,
} from "@/lib/ingest/schema";

function ok(json: unknown): ParsedPayload {
  const r = parsePayload(json);
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.issues)}`);
  return r.payload;
}

function issues(json: unknown) {
  const r = parsePayload(json);
  if (r.ok) throw new Error("expected issues");
  return r.issues;
}

describe("parseNumeric", () => {
  it.each([
    [7412, 7412],
    [51.5, 51.5],
    [null, null],
    ["7412", 7412],
    ["7412.0", 7412],
    [" 51 ", 51],
    [" 51 ", 51],
    ["7,412", 7412],
    ["1,234,567.89", 1234567.89],
    ["-3.5", -3.5],
    ["+2", 2],
    [".5", 0.5],
    ["5.", 5],
    ["1e3", 1000],
    ["", null],
    ["   ", null],
  ])("%j -> %j", (input, expected) => {
    expect(parseNumeric(input)).toEqual({ ok: true, value: expected });
  });

  it.each(["abc", "12abc", "7 412", "1,2", "12,34", "1,2345", "7,412,", ",412", "0x10", "NaN", "Infinity", "51,5", true, {}, [], [1]])(
    "rejects %j",
    (input) => {
      expect(parseNumeric(input)).toEqual({ ok: false });
    },
  );
});

describe("normalizeMetricValue", () => {
  it("rounds int fields, range-checks, and converts fractions", () => {
    expect(normalizeMetricValue(getMetricField("steps"), 7412.4)).toBe(7412);
    expect(normalizeMetricValue(getMetricField("steps"), 7412.5)).toBe(7413);
    expect(normalizeMetricValue(getMetricField("steps"), -1)).toMatch(/out of range/);
    expect(normalizeMetricValue(getMetricField("resting_hr"), 5)).toMatch(/out of range.*20-200 bpm/);
    expect(normalizeMetricValue(getMetricField("spo2_pct"), 0.97)).toBeCloseTo(97);
    expect(normalizeMetricValue(getMetricField("spo2_pct"), 1)).toBe(100);
    expect(normalizeMetricValue(getMetricField("spo2_pct"), 97)).toBe(97);
    expect(normalizeMetricValue(getMetricField("spo2_pct"), 0.3)).toMatch(/out of range/); // 30% is out of range either way
    expect(normalizeMetricValue(getMetricField("body_fat_pct"), 0.215)).toBeCloseTo(21.5);
    expect(normalizeMetricValue(getMetricField("body_fat_pct"), 1)).toBe(1); // 100% is impossible: read as 1%
    expect(normalizeMetricValue(getMetricField("body_fat_pct"), 21.5)).toBe(21.5);
  });
});

describe("splitColumn", () => {
  it("splits on any newline; trailing blanks are trimmed separately", () => {
    expect(splitColumn("58\n61\r\n63\r64\n")).toEqual(["58", "61", "63", "64", ""]);
    expect(splitColumn("")).toEqual([]);
    expect(splitColumn("a\n\nb")).toEqual(["a", "", "b"]);
    expect(trimTrailingBlanks(["a", "", " ", null])).toEqual(["a"]);
    expect(trimTrailingBlanks(["a", "", " "], 2)).toEqual(["a", ""]);
  });
});

describe("parsePayload shapes", () => {
  const day = { date: "2026-09-28", steps: 8000, resting_hr: "52" };

  it("accepts a single Day, an array of Days, and { days }", () => {
    const single = ok(day);
    const array = ok([day, { date: "2026-09-27" }]);
    const object = ok({ days: [day], tz: "Europe/Berlin", sleep_segments: [] });
    expect(single.shape).toBe("day");
    expect(array.shape).toBe("array");
    expect(object.shape).toBe("object");
    expect(object.tz).toBe("Europe/Berlin");
    for (const p of [single, array, object]) {
      expect(p.days[0]).toEqual({ date: "2026-09-28", metrics: { steps: 8000, resting_hr: 52 }, hrHourly: undefined, segments: [] });
    }
    expect(array.days[1].metrics).toEqual({});
  });

  it("keeps explicit nulls apart from absent keys; empty strings are null", () => {
    const p = ok({ date: "2026-09-28", steps: null, hrv_sdnn_ms: "", resting_hr: 50 });
    expect(p.days[0].metrics).toEqual({ steps: null, hrv_sdnn_ms: null, resting_hr: 50 });
    expect(Object.hasOwn(p.days[0].metrics, "vo2max")).toBe(false);
  });

  it("strips unknown keys from what is parsed", () => {
    const p = ok({ date: "2026-09-28", steps: 1, mystery: 5 });
    expect(p.days[0].metrics).toEqual({ steps: 1 });
  });

  it("reports issues with paths in the payload's own shape", () => {
    expect(issues({ date: "2026-09-28", steps: "lots" })).toEqual([
      { path: ["steps"], message: 'expected a number, got "lots"' },
    ]);
    expect(issues([{ date: "2026-09-28" }, { date: "2026-09-28", resting_hr: 5 }])[0]).toEqual({
      path: [1, "resting_hr"],
      message: "out of range: 5 (allowed 20-200 bpm)",
    });
    expect(issues({ days: [{ date: "2026-02-30" }] })[0]).toMatchObject({ path: ["days", 0, "date"] });
    expect(issues({ days: [{ steps: 1 }] })[0]).toMatchObject({ path: ["days", 0, "date"] });
    expect(issues({ days: "nope" })[0]).toMatchObject({ path: ["days"] });
    expect(issues(42)[0].message).toMatch(/expected a Day object/);
    expect(issues([])[0].message).toMatch(/no days/);
    expect(issues([1])[0]).toEqual({ path: [0], message: "expected a Day object" });
  });

  it(`limits days to ${MAX_DAYS}`, () => {
    const days = Array.from({ length: MAX_DAYS + 1 }, () => ({ date: "2026-09-28" }));
    expect(issues(days)[0].message).toMatch(/at most 366 days/);
    expect(issues({ days })[0]).toMatchObject({ path: ["days"] });
    expect(ok(days.slice(1)).days).toHaveLength(MAX_DAYS);
  });

  it("limits sleep segments to 5000 per request", () => {
    const seg = { stage: "Core", start: "2026-09-28T01:00:00Z", end: "2026-09-28T02:00:00Z" };
    const r = issues({ days: [{ date: "2026-09-28", sleep_segments: Array(2500).fill(seg) }], sleep_segments: Array(2501).fill(seg) });
    expect(r[0].message).toMatch(/at most 5000 sleep segments/);
  });
});

describe("hr_hourly", () => {
  const rows = [
    { hour: 0, avg: 55, min: 50, max: 61 },
    { hour: 1, avg: "54", min: "", max: "60" },
  ];

  it("array and columnar (newline strings) are equivalent", () => {
    const fromArray = ok({ date: "2026-09-28", hr_hourly: rows }).days[0].hrHourly;
    // A trailing newline doesn't add a row; an empty last cell ("50\n" for two rows) is a null value.
    const fromColumns = ok({ date: "2026-09-28", hr_hourly: { hours: "0\n1\n", avg: "55\n54\n", min: "50\n", max: "61\n60" } })
      .days[0].hrHourly;
    const expected = [
      { hour: 0, avg: 55, min: 50, max: 61 },
      { hour: 1, avg: 54, min: null, max: 60 },
    ];
    expect(fromArray).toEqual(expected);
    expect(fromColumns).toEqual(expected);
  });

  it("columns may be JSON arrays too, and `starts` instead of `hours`", () => {
    const p = ok({ date: "2026-09-28", hr_hourly: { starts: ["2026-09-28T00:00:00Z", "2026-09-28T01:00:00Z"], avg: [55, 54] } });
    expect(p.days[0].hrHourly).toEqual([
      { start: "2026-09-28T00:00:00Z", avg: 55, min: null, max: null },
      { start: "2026-09-28T01:00:00Z", avg: 54, min: null, max: null },
    ]);
  });

  it("rejects unequal columns, both/neither of hours and starts, bad values, too many rows", () => {
    expect(issues({ date: "2026-09-28", hr_hourly: { hours: "0\n1", avg: "55" } })[0]).toEqual({
      path: ["hr_hourly"],
      message: "columns must have equal length (hours: 2, avg: 1)",
    });
    expect(issues({ date: "2026-09-28", hr_hourly: { avg: "55" } })[0].message).toMatch(/exactly one of/);
    expect(issues({ date: "2026-09-28", hr_hourly: { hours: "0", starts: "x", avg: "55" } })[0].message).toMatch(/exactly one of/);
    expect(issues({ date: "2026-09-28", hr_hourly: { hours: "0\n24", avg: "55\n56" } })[0]).toEqual({
      path: ["hr_hourly", "hours", 1],
      message: "out of range: 24 (allowed 0-23)",
    });
    expect(issues({ date: "2026-09-28", hr_hourly: [{ hour: 1.5, avg: 50 }] })[0]).toMatchObject({ path: ["hr_hourly", 0, "hour"] });
    expect(issues({ date: "2026-09-28", hr_hourly: [{ avg: 50 }] })[0].message).toMatch(/needs `hour`/);
    expect(issues({ date: "2026-09-28", hr_hourly: [{ hour: 3, avg: 400 }] })[0]).toMatchObject({ path: ["hr_hourly", 0, "avg"] });
    expect(issues({ date: "2026-09-28", hr_hourly: "58" })[0].message).toMatch(/expected an array or an object/);
    const many = Array.from({ length: 49 }, (_, i) => ({ hour: i % 24, avg: 60 }));
    expect(issues({ date: "2026-09-28", hr_hourly: many })[0].message).toMatch(/at most 48/);
  });

  it("null or [] means clear the day", () => {
    expect(ok({ date: "2026-09-28", hr_hourly: null }).days[0].hrHourly).toEqual([]);
    expect(ok({ date: "2026-09-28", hr_hourly: [] }).days[0].hrHourly).toEqual([]);
    expect(ok({ date: "2026-09-28", hr_hourly: { hours: "", avg: "" } }).days[0].hrHourly).toEqual([]);
  });
});

describe("sleep segments", () => {
  const array = [
    { stage: "Core", start: "2026-09-28T01:00:00+02:00", end: "2026-09-28T02:00:00+02:00", source: "Apple Watch" },
    { stage: "Deep", start: "2026-09-28T02:00:00+02:00", end: "2026-09-28T02:30:00+02:00", source: null },
  ];
  const columnar = {
    stages: "Core\nDeep\n",
    starts: "2026-09-28T01:00:00+02:00\n2026-09-28T02:00:00+02:00",
    ends: "2026-09-28T02:00:00+02:00\n2026-09-28T02:30:00+02:00",
    sources: "Apple Watch\n",
  };

  it("array and columnar forms are equivalent; top level and per day are pooled", () => {
    const a = ok({ days: [{ date: "2026-09-28" }], sleep_segments: array }).segments;
    const c = ok({ days: [{ date: "2026-09-28", sleep_segments: columnar }] }).segments;
    expect(c).toEqual(a);
    const c2 = ok({ days: [], sleep_segments: { ...columnar, stages: ["Core", "Deep"], sources: ["Apple Watch", null] } }).segments;
    expect(c2).toEqual(a);
    expect(a).toEqual([
      { stage: "Core", start: "2026-09-28T01:00:00+02:00", end: "2026-09-28T02:00:00+02:00", source: "Apple Watch" },
      { stage: "Deep", start: "2026-09-28T02:00:00+02:00", end: "2026-09-28T02:30:00+02:00", source: "" },
    ]);
    const both = ok({ days: [{ date: "2026-09-28", sleep_segments: array.slice(0, 1) }], sleep_segments: array.slice(1) }).segments;
    expect(both).toHaveLength(2);
  });

  it("reports column paths for bad cells", () => {
    const bad = { stages: "Core\nDeep", starts: "2026-09-28T01:00:00Z\n", ends: "x\ny" };
    expect(issues({ days: [{ date: "2026-09-28" }], sleep_segments: bad })[0]).toEqual({
      path: ["sleep_segments"],
      message: "columns must have equal length (stages: 2, starts: 1, ends: 2)",
    });
    const r = issues({ days: [], sleep_segments: { stages: ["Core", "Deep"], starts: ["", "2026-09-28T01:00:00Z"], ends: ["x", "y"] } });
    expect(r[0]).toMatchObject({ path: ["sleep_segments", "starts", 0] });
  });
});

describe("normalizeIngest", () => {
  const NOW = new Date("2026-09-29T12:00:00Z");

  it("resolves the timezone: payload, else profile, else UTC", () => {
    expect(resolveTimezone("Europe/Berlin", "Asia/Tokyo")).toEqual({ tz: "Europe/Berlin", source: "payload" });
    expect(resolveTimezone("Mars/Base", "Asia/Tokyo")).toEqual({ tz: "Asia/Tokyo", source: "profile", ignored: "Mars/Base" });
    expect(resolveTimezone(undefined, null)).toEqual({ tz: "UTC", source: "default" });
    expect(resolveTimezone("+02:00", "bogus")).toEqual({ tz: "UTC", source: "default", ignored: "+02:00" });
  });

  it("future dates depend on the user's timezone (Kiritimati vs Pago Pago)", () => {
    // At 12:00Z Sep 29: Kiritimati (UTC+14) is on Sep 30, Pago Pago (UTC-11) on Sep 29.
    expect(dateWindow("Pacific/Kiritimati", NOW)).toMatchObject({ today: "2026-09-30", max: "2026-10-01" });
    expect(dateWindow("Pacific/Pago_Pago", NOW)).toMatchObject({ today: "2026-09-29", max: "2026-09-30" });
    const p = ok({ date: "2026-10-01", steps: 1 });
    expect(normalizeIngest(p, { profileTz: "Pacific/Kiritimati", now: NOW }).ok).toBe(true);
    const r = normalizeIngest(p, { profileTz: "Pacific/Pago_Pago", now: NOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0].message).toMatch(/after 2026-09-30.*Pacific\/Pago_Pago.*2026-10-01/);
    // The payload tz wins over the profile.
    expect(normalizeIngest(ok({ days: [{ date: "2026-10-01" }], tz: "Pacific/Kiritimati" }), { profileTz: "Pacific/Pago_Pago", now: NOW }).ok).toBe(true);
  });

  it("rejects dates older than 400 days and lists them", () => {
    const edge = normalizeIngest(ok([{ date: "2025-08-26" }, { date: "2025-08-25" }]), { profileTz: "UTC", now: NOW });
    expect(edge.ok).toBe(true);
    const r = normalizeIngest(ok([{ date: "2025-08-24" }, { date: "2020-01-01" }, { date: "2026-09-28" }]), { profileTz: "UTC", now: NOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0].message).toMatch(/before 2025-08-25.*2020-01-01, 2025-08-24/);
  });

  it("merges duplicate dates (later keys win)", () => {
    const r = normalizeIngest(
      ok([
        { date: "2026-09-28", steps: 1, resting_hr: 50, hr_hourly: [{ hour: 1, avg: 60 }] },
        { date: "2026-09-27", steps: 5 },
        { date: "2026-09-28", steps: 2, vo2max: null },
      ]),
      { now: NOW },
    );
    if (!r.ok) throw new Error();
    expect(r.value.duplicateDates).toEqual(["2026-09-28"]);
    expect(r.value.days.map((d) => d.date)).toEqual(["2026-09-27", "2026-09-28"]);
    expect(r.value.days[1].metrics).toEqual({ steps: 2, resting_hr: 50, vo2max: null });
    expect(r.value.days[1].hrHourly).toEqual([{ hour: 1, avg: 60, min: null, max: null }]);
  });

  it("hr_hourly: starts become local hours; other dates, missing avg and duplicate hours are dropped and counted", () => {
    const columnar = normalizeIngest(
      ok({
        tz: "America/New_York",
        days: [
          {
            date: "2026-09-28",
            hr_hourly: {
              starts: [
                "2026-09-28T04:00:00Z", // 00:00 EDT on the 28th
                "2026-09-28T03:00:00Z", // 23:00 EDT on the 27th: other date
                "2026-09-28T17:00:00Z", // 13:00
                "Sep 28, 2026 at 1:30 PM", // 13:xx again: the later row wins
                "2026-09-28T18:00:00Z", // no avg (blank last cell)
              ].join("\n"),
              avg: "55\n60\n70\n72\n",
              max: "60\n70\n80\n90\n",
            },
          },
        ],
      }),
      { now: NOW },
    );
    if (!columnar.ok) throw new Error(JSON.stringify(columnar.issues));
    expect(columnar.value.days[0].hrHourly).toEqual([
      { hour: 0, avg: 55, min: null, max: 60 },
      { hour: 13, avg: 72, min: null, max: 90 },
    ]);
    expect({ ...columnar.value.hrDropped }).toEqual({ other_date: 1, duplicate_hour: 1, no_avg: 1 });

    const r2 = normalizeIngest(
      ok({
        tz: "America/New_York",
        days: [
          {
            date: "2026-09-28",
            hr_hourly: [
              { start: "2026-09-28T04:00:00Z", avg: 55, max: 60 },
              { start: "2026-09-28T03:00:00Z", avg: 60, max: 70 },
              { start: "2026-09-28T17:00:00Z", avg: 70, max: 80 },
              { start: "Sep 28, 2026 at 1:30 PM", avg: 72, max: 90 },
              { start: "2026-09-28T18:00:00Z", avg: null },
              { hour: 5, avg: "58" },
            ],
          },
        ],
      }),
      { now: NOW },
    );
    if (!r2.ok) throw new Error(JSON.stringify(r2.issues));
    expect(r2.value.days[0].hrHourly).toEqual([
      { hour: 0, avg: 55, min: null, max: 60 },
      { hour: 5, avg: 58, min: null, max: null },
      { hour: 13, avg: 72, min: null, max: 90 },
    ]);
    expect(r2.value.hrDropped).toEqual({ other_date: 1, duplicate_hour: 1, no_avg: 1 });
  });

  it("an unparseable hr start is a validation error", () => {
    const r = normalizeIngest(ok({ date: "2026-09-28", hr_hourly: [{ start: "noon-ish", avg: 60 }] }), { now: NOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0]).toEqual({ path: ["2026-09-28", "hr_hourly", 0, "start"], message: 'unparseable timestamp "noon-ish"' });
  });

  it("sleep: unknown stages, bad ordering, >24h and duplicates are dropped and counted; nights built", () => {
    const seg = (stage: string, start: string, end: string, source = "Watch") => ({ stage, start, end, source });
    const p = ok({
      tz: "Europe/Berlin",
      days: [{ date: "2026-09-28" }],
      sleep_segments: [
        seg("Core", "2026-09-27T23:00:00+02:00", "2026-09-28T03:00:00+02:00"),
        seg("Core", "2026-09-27T23:00:00+02:00", "2026-09-28T03:00:00+02:00"), // duplicate
        seg("REM", "2026-09-28T03:00:00+02:00", "2026-09-28T04:00:00+02:00"),
        seg("Restless", "2026-09-28T04:00:00+02:00", "2026-09-28T05:00:00+02:00"),
        seg("Restless", "2026-09-28T05:00:00+02:00", "2026-09-28T05:10:00+02:00"),
        seg("Deep", "2026-09-28T05:00:00+02:00", "2026-09-28T04:00:00+02:00"), // end < start
        seg("Asleep", "2026-09-20T00:00:00+02:00", "2026-09-22T00:00:00+02:00"), // 48 h
        seg("In Bed", "2026-09-28T14:00:00+02:00", "2026-09-28T14:30:00+02:00", "iPhone"), // nap
        seg("Asleep", "2026-10-02T01:00:00+02:00", "2026-10-02T07:00:00+02:00"), // wakes on a future date
      ],
    });
    const r = normalizeIngest(p, { now: NOW });
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    const v = r.value;
    expect(v.unknownStages).toEqual({ Restless: 2 });
    expect(v.droppedSegments).toEqual({ duplicate: 1, end_before_start: 1, too_long: 1, future: 1 });
    expect(v.napsIgnored).toBe(1);
    expect(v.segments).toHaveLength(4);
    expect(v.nights.map((n) => n.wakeDate)).toEqual(["2026-09-28"]);
    expect(v.nights[0].summary).toMatchObject({ chosenSource: "Watch", coreMin: 240, remMin: 60, asleepMin: 300 });
    expect({ ...v.sleepSources }).toEqual({ Watch: ["core", "rem", "asleep"], iPhone: ["in_bed"] });
  });

  it("an unparseable segment timestamp is a validation error", () => {
    const p = ok({ days: [], sleep_segments: [{ stage: "Core", start: "yesterday", end: "2026-09-28T01:00:00Z" }] });
    const r = normalizeIngest(p, { now: NOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0]).toMatchObject({ path: ["sleep_segments", 0, "start"] });
  });

  it("source names like __proto__ are just names", () => {
    const p = ok({
      days: [],
      sleep_segments: [
        { stage: "Asleep", start: "2026-09-28T00:00:00Z", end: "2026-09-28T06:00:00Z", source: "__proto__" },
        { stage: "Asleep", start: "2026-09-28T00:00:00Z", end: "2026-09-28T05:00:00Z", source: "constructor" },
      ],
    });
    const r = normalizeIngest(p, { now: NOW });
    if (!r.ok) throw new Error();
    expect(Object.keys(r.value.sleepSources).sort()).toEqual(["__proto__", "constructor"]);
    expect(r.value.nights[0].summary.chosenSource).toBe("__proto__");
    expect(({} as Record<string, unknown>).push).toBeUndefined();
  });
});
