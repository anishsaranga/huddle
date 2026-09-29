import { describe, expect, it } from "vitest";
import { normalizeIngest, type NormalizedIngest } from "@/lib/ingest/normalize";
import { parsePayload, type ParsedPayload } from "@/lib/ingest/schema";
import { pivotSeries, seriesDates } from "@/lib/ingest/series";
import { buildSummary, collectUnknownFields, partialSummary } from "@/lib/ingest/summary";

// 17:30 in Kolkata, 14:00 in Berlin, 13:00 in London: today is 2026-09-29 everywhere used here.
const NOW = new Date("2026-09-29T12:00:00Z");
const NNBSP = " ";
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v));

function parsed(json: unknown): ParsedPayload {
  const r = parsePayload(json);
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.issues)}`);
  return r.payload;
}

function parseIssues(json: unknown) {
  const r = parsePayload(json);
  if (r.ok) throw new Error("expected issues");
  return r.issues;
}

function norm(json: unknown, profileTz = "Asia/Kolkata", now = NOW): NormalizedIngest {
  const r = normalizeIngest(parsed(json), { profileTz, now });
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.issues)}`);
  return r.value;
}

function normIssues(json: unknown, profileTz = "Asia/Kolkata") {
  const r = normalizeIngest(parsed(json), { profileTz, now: NOW });
  if (r.ok) throw new Error("expected issues");
  return r.issues;
}

/** date -> metrics, for compact assertions. */
const metricsByDate = (n: NormalizedIngest) => Object.fromEntries(n.days.map((d) => [d.date, d.metrics]));

describe("series: parsing", () => {
  it("is detected by the `series` key and keeps the other shapes apart", () => {
    const p = parsed({
      series: { steps: { starts: "2026-09-28", values: "7412" } },
      meta: { shortcut_version: "1" },
    });
    expect(p.shape).toBe("series");
    expect(p.days).toEqual([]);
    expect(p.series!.metrics.steps).toEqual({
      starts: ["2026-09-28"],
      values: [7412],
    });
    expect(p.meta).toEqual({ shortcut_version: "1" });
  });

  it("coerces values like the other shapes (numeric strings, empty = null, fractions -> %), per value", () => {
    const p = parsed({
      series: {
        steps: { starts: "2026-09-27\n2026-09-28\n", values: "7,412\n\n" },
        spo2_pct: { starts: ["2026-09-28"], values: ["0.97"] },
      },
    });
    expect(p.series!.metrics.steps).toEqual({
      starts: ["2026-09-27", "2026-09-28"],
      values: [7412, null],
    });
    expect(p.series!.metrics.spo2_pct!.values[0]).toBeCloseTo(97);
  });

  it("400s a column length mismatch, naming the series", () => {
    const issues = parseIssues({
      series: {
        resting_hr: {
          starts: "2026-09-27\n2026-09-28\n2026-09-29",
          values: "52\n51",
        },
      },
    });
    expect(issues).toEqual([
      {
        path: ["series", "resting_hr"],
        message: 'series "resting_hr": starts and values need the same number of lines (starts: 3, values: 2)',
      },
    ]);
  });

  it("reports bad values and starts with their row", () => {
    const issues = parseIssues({
      series: {
        steps: { starts: "2026-09-27\n2026-09-28", values: "lots\n5" },
        resting_hr: { starts: "2026-09-28", values: "5" },
        vo2max: { starts: "\n2026-09-28", values: "40\n41" },
        hrv_sdnn_ms: "nope",
      },
    });
    expect(issues).toEqual([
      {
        path: ["series", "steps", "values", 0],
        message: 'expected a number, got "lots"',
      },
      {
        path: ["series", "resting_hr", "values", 0],
        message: "out of range: 5 (allowed 20-200 bpm)",
      },
      {
        path: ["series", "hrv_sdnn_ms"],
        message: "expected { starts, values } (newline-joined text or arrays)",
      },
      {
        path: ["series", "vo2max", "starts", 0],
        message: 'expected a timestamp or date, got ""',
      },
    ]);
  });

  it("ignores unknown series names (recorded as unknown fields by plain name)", () => {
    const json = {
      series: {
        steps: { starts: "2026-09-28", values: "1", note: "x" },
        cycling_km: { starts: "2026-09-28", values: "12" },
      },
      window: { from: "2026-09-28", to: "2026-09-28", extra: 1 },
      hr: { starts: "2026-09-28T08:00:00+05:30", avg: "70", peak: "90" },
      fancy: true,
    };
    const p = parsed(json);
    expect(Object.keys(p.series!.metrics)).toEqual(["steps"]);
    expect(plain(collectUnknownFields(json))).toEqual({
      "top.fancy": { count: 1, types: ["boolean"] },
      cycling_km: { count: 1, types: ["object"] },
      "series.note": { count: 1, types: ["string"] },
      "window.extra": { count: 1, types: ["number"] },
      "hr.peak": { count: 1, types: ["string"] },
    });
  });

  it("validates the window: real dates, from <= to, at most 366 days", () => {
    expect(
      parseIssues({
        series: {},
        window: { from: "2026-09-28", to: "2026-09-26" },
      })[0],
    ).toEqual({
      path: ["window"],
      message: "window.from (2026-09-28) is after window.to (2026-09-26)",
    });
    expect(
      parseIssues({
        series: {},
        window: { from: "2025-01-01", to: "2026-01-02" },
      })[0].message,
    ).toMatch(/at most 366 days \(got 367\)/);
    expect(
      parseIssues({
        series: {},
        window: { from: "2026-02-30", to: "2026-03-02" },
      })[0].path,
    ).toEqual(["window", "from"]);
    expect(parseIssues({ series: {}, window: "last 3 days" })[0].path).toEqual(["window"]);
  });

  it("rejects hr by `hours`, days + series together, a non-object meta, and an empty payload", () => {
    expect(parseIssues({ series: {}, hr: { hours: "1\n2", avg: "50\n51" } })[0].message).toMatch(/need `starts`/);
    expect(
      parseIssues({
        series: { steps: { starts: "2026-09-28", values: "1" } },
        days: [],
      })[0].path,
    ).toEqual(["days"]);
    expect(
      parseIssues({
        series: { steps: { starts: "2026-09-28", values: "1" } },
        meta: "v1",
      })[0],
    ).toEqual({
      path: ["meta"],
      message: "meta must be an object",
    });
    expect(parseIssues({ series: {} })[0].message).toMatch(/nothing to ingest/);
  });

  it("keeps only primitive meta values, bounded", () => {
    const p = parsed({
      series: { steps: { starts: "2026-09-28", values: "1" } },
      meta: {
        device: "iPhone 15",
        v: 3,
        beta: false,
        none: null,
        nested: { a: 1 },
        long: "x".repeat(500),
      },
    });
    expect(p.meta).toEqual({
      device: "iPhone 15",
      v: 3,
      beta: false,
      none: null,
      long: "x".repeat(200),
    });
  });
});

describe("series: dates from group starts", () => {
  it("reads ISO timestamps, Shortcuts' English format (with a narrow no-break space) and plain dates", () => {
    const n = norm({
      tz: "Asia/Kolkata",
      series: {
        steps: {
          starts: "2026-09-26T00:00:00+05:30\nSep 27, 2026 at 12:00" + NNBSP + "AM\n2026-09-28",
          values: "7412\n9020\n8100",
        },
        resting_hr: {
          starts: "27 Sep 2026 at 00:00\nSep 28, 2026",
          values: "52\n51",
        },
      },
    });
    expect(metricsByDate(n)).toEqual({
      "2026-09-26": { steps: 7412 },
      "2026-09-27": { steps: 9020, resting_hr: 52 },
      "2026-09-28": { steps: 8100, resting_hr: 51 },
    });
    expect(n.series!.tzAdjustments).toBe(0);
  });

  it("rounds day groups that start near midnight in a mismatched timezone, and counts it", () => {
    // Phone in Berlin (UTC+2) groups by its midnight; the profile is London (UTC+1): 23:00 the day before.
    const starts = ["2026-09-26T00:00:00+02:00", "2026-09-27T00:00:00+02:00", "2026-09-28T00:00:00+02:00"];
    expect(seriesDates(starts, "Europe/London")).toEqual({
      dates: ["2026-09-26", "2026-09-27", "2026-09-28"],
      adjustments: 3,
    });
    // ...and the other way round (01:00 local): same dates, still counted.
    expect(seriesDates(["2026-09-27T00:00:00+00:00"], "Europe/Berlin")).toEqual({ dates: ["2026-09-27"], adjustments: 1 });
    // Exactly midnight: nothing to adjust.
    expect(seriesDates(["2026-09-27T00:00:00+02:00"], "Europe/Berlin")).toEqual({ dates: ["2026-09-27"], adjustments: 0 });

    const n = norm({ series: { steps: { starts: starts.join("\n"), values: "1\n2\n3" } } }, "Europe/London");
    expect(metricsByDate(n)).toEqual({
      "2026-09-26": { steps: 1 },
      "2026-09-27": { steps: 2 },
      "2026-09-28": { steps: 3 },
    });
    expect(n.series!.tzAdjustments).toBe(3);
  });

  it("does not round an ungrouped series (samples spread over the day)", () => {
    const { dates, adjustments } = seriesDates(
      ["2026-09-27T23:30:00+02:00", "2026-09-28T09:15:00+02:00", "2026-09-28T00:30:00+02:00"],
      "Europe/Berlin",
    );
    expect(dates).toEqual(["2026-09-27", "2026-09-28", "2026-09-28"]);
    expect(adjustments).toBe(0);
  });

  it("400s an unparseable start with its row", () => {
    expect(
      normIssues({
        series: { steps: { starts: "2026-09-28\nyesterday", values: "1\n2" } },
      }),
    ).toEqual([
      {
        path: ["series", "steps", "starts", 1],
        message: 'unparseable timestamp or date "yesterday"',
      },
    ]);
  });
});

describe("series: window and null fill", () => {
  const window = { from: "2026-09-26", to: "2026-09-29" }; // today (Kolkata) is 2026-09-29

  it("fills sent metrics with null for window dates up to yesterday; today and unsent metrics stay absent", () => {
    const n = norm({
      window,
      series: {
        steps: { starts: "2026-09-26\n2026-09-28", values: "7000\n8000" },
        resting_hr: { starts: "", values: "" }, // sent, but Health had nothing
      },
    });
    expect(metricsByDate(n)).toEqual({
      "2026-09-26": { steps: 7000, resting_hr: null },
      "2026-09-27": { steps: null, resting_hr: null },
      "2026-09-28": { steps: 8000, resting_hr: null },
      // 2026-09-29 (today): nothing sent for it, nothing filled -> no day at all
    });
    expect(n.series!.nullFilled).toEqual({ steps: 1, resting_hr: 3 });
  });

  it("today's values are written when present", () => {
    const n = norm({
      window,
      series: { steps: { starts: "2026-09-29", values: "1200" } },
    });
    expect(metricsByDate(n)["2026-09-29"]).toEqual({ steps: 1200 });
    expect(n.series!.nullFilled).toEqual({ steps: 3 });
  });

  it("drops rows outside the window (the partial first day of a rolling query) and counts them", () => {
    const n = norm({
      window,
      series: {
        steps: { starts: "2026-09-25\n2026-09-26", values: "300\n7000" },
      },
    });
    expect(metricsByDate(n)["2026-09-25"]).toBeUndefined();
    expect(n.series!.outsideWindow).toEqual({ steps: 1 });
  });

  it("without a window, absent dates are just absent", () => {
    const n = norm({
      series: {
        steps: { starts: "2026-09-26\n2026-09-28", values: "7000\n8000" },
        resting_hr: { starts: "2026-09-28", values: "50" },
      },
    });
    expect(metricsByDate(n)).toEqual({
      "2026-09-26": { steps: 7000 },
      "2026-09-28": { steps: 8000, resting_hr: 50 },
    });
    expect(n.series!.nullFilled).toEqual({});
  });

  it("applies the usual date rules: the window and (without one) the series dates", () => {
    expect(
      normIssues({
        window: { from: "2026-09-28", to: "2026-10-01" },
        series: {},
        sleep_segments: [
          {
            stage: "Core",
            start: "2026-09-28T01:00:00Z",
            end: "2026-09-28T02:00:00Z",
          },
        ],
      }),
    ).toEqual([
      {
        path: ["window", "to"],
        message: "window.to 2026-10-01 is after 2026-09-30 (today+1 in Asia/Kolkata)",
      },
    ]);
    expect(
      normIssues({
        window: { from: "2025-01-01", to: "2025-01-02" },
        series: { steps: { starts: "", values: "" } },
      })[0].path,
    ).toEqual(["window", "from"]);
    expect(
      normIssues({
        series: { steps: { starts: "2026-10-05", values: "1" } },
      })[0].message,
    ).toMatch(/dates after 2026-09-30.*2026-10-05/);
  });
});

describe("series: several values for one date (no Group By)", () => {
  it("sums cumulative metrics and averages discrete ones, counting the dates", () => {
    const n = norm({
      series: {
        steps: {
          starts: "2026-09-28T08:00:00\n2026-09-28T12:00:00\n2026-09-28T18:30:00\n2026-09-27T09:00:00",
          values: "1000\n2500\n\n400",
        },
        resting_hr: {
          starts: "2026-09-28T07:00:00\n2026-09-28T19:00:00",
          values: "50\n55",
        },
        spo2_pct: {
          starts: "2026-09-28T02:00:00\n2026-09-28T03:00:00",
          values: "0.96\n98",
        },
      },
    });
    expect(metricsByDate(n)).toEqual({
      "2026-09-27": { steps: 400 },
      "2026-09-28": { steps: 3500, resting_hr: 52.5, spo2_pct: 97 },
    });
    expect(n.series!.multiValueDates).toEqual({
      steps: 1,
      resting_hr: 1,
      spo2_pct: 1,
    });
  });

  it("400s a sum that ends up out of range", () => {
    const issues = normIssues({
      series: {
        exercise_min: {
          starts: "2026-09-28\n2026-09-28",
          values: "1000\n1000",
        },
      },
    });
    expect(issues).toEqual([
      {
        path: ["series", "exercise_min"],
        message: "2026-09-28: 2 values combined are out of range: 2000 (allowed 0-1440 min)",
      },
    ]);
  });
});

describe("series: hourly heart rate", () => {
  it("maps starts to (local date, hour) across midnight; replaces only dates with rows", () => {
    const n = norm({
      window: { from: "2026-09-27", to: "2026-09-28" },
      series: {},
      hr: {
        starts: [
          "2026-09-26T23:00:00+05:30", // outside the window
          "2026-09-27T22:00:00+05:30",
          "2026-09-27T23:00:00+05:30",
          "Sep 28, 2026 at 12:00" + NNBSP + "AM",
          "2026-09-28T01:00:00+05:30",
          "2026-09-28T01:00:00+05:30", // duplicate: last wins
          "2026-09-28T02:00:00+05:30", // no avg
        ].join("\n"),
        avg: "60\n58\n56\n54\n52\n51\n",
        min: "50\n50\n50\n50\n50\n49\n",
      },
    });
    expect(n.days.map((d) => [d.date, d.hrHourly])).toEqual([
      [
        "2026-09-27",
        [
          { hour: 22, avg: 58, min: 50, max: null },
          { hour: 23, avg: 56, min: 50, max: null },
        ],
      ],
      [
        "2026-09-28",
        [
          { hour: 0, avg: 54, min: 50, max: null },
          { hour: 1, avg: 51, min: 49, max: null },
        ],
      ],
    ]);
    expect(n.series!.outsideWindow).toEqual({ hr: 1 });
    expect(n.hrDropped).toEqual({ no_avg: 1, duplicate_hour: 1 });
  });

  it("leaves dates without hr rows untouched (even past window dates)", () => {
    const n = norm({
      window: { from: "2026-09-26", to: "2026-09-28" },
      series: {
        steps: {
          starts: "2026-09-26\n2026-09-27\n2026-09-28",
          values: "1\n2\n3",
        },
      },
      hr: { starts: "2026-09-28T09:00:00+05:30", avg: "70" },
    });
    expect(n.days.map((d) => [d.date, d.hrHourly === undefined])).toEqual([
      ["2026-09-26", true],
      ["2026-09-27", true],
      ["2026-09-28", false],
    ]);
  });

  it("handles DST: spring forward skips an hour, fall back repeats one (last wins)", () => {
    // Europe/Berlin: 2026-03-29 02:00 -> 03:00 (CET -> CEST).
    const spring = norm(
      {
        series: {},
        hr: {
          starts:
            "2026-03-28T23:00:00+01:00\n2026-03-29T00:00:00+01:00\n2026-03-29T01:00:00+01:00\n2026-03-29T03:00:00+02:00\n2026-03-29T04:00:00+02:00",
          avg: "50\n51\n52\n53\n54",
        },
      },
      "Europe/Berlin",
    );
    expect(spring.days.map((d) => [d.date, d.hrHourly!.map((r) => r.hour)])).toEqual([
      ["2026-03-28", [23]],
      ["2026-03-29", [0, 1, 3, 4]],
    ]);

    // 2026-10-25 03:00 CEST -> 02:00 CET: the 02:00 hour happens twice (pivot only; that date is in the future here).
    const fall = parsed({
      series: {},
      hr: {
        starts: "2026-10-25T01:00:00+02:00\n2026-10-25T02:00:00+02:00\n2026-10-25T02:00:00+01:00\n2026-10-25T03:00:00+01:00",
        avg: "50\n51\n52\n53",
      },
    });
    const pivot = pivotSeries(fall.series!, "Europe/Berlin", "2026-10-26");
    if (!pivot.ok) throw new Error();
    expect(pivot.days[0].hrHourly!.map((r) => [r.hour, r.avg])).toEqual([
      [1, 50],
      [2, 51],
      [2, 52],
      [3, 53],
    ]);
    const n = normalizeIngest(fall, {
      profileTz: "Europe/Berlin",
      now: new Date("2026-10-26T12:00:00Z"),
    });
    if (!n.ok) throw new Error();
    expect(n.value.days[0].hrHourly!.map((r) => [r.hour, r.avg])).toEqual([
      [1, 50],
      [2, 52],
      [3, 53],
    ]);
    expect(n.value.hrDropped).toEqual({ duplicate_hour: 1 });
  });

  it("400s an unparseable hr start", () => {
    expect(
      normIssues({
        series: {},
        hr: { starts: "2026-09-28T01:00:00Z\nnoon", avg: "50\n51" },
      }),
    ).toEqual([{ path: ["hr", "starts", 1], message: 'unparseable timestamp "noon"' }]);
  });
});

describe("series: summary", () => {
  it("records shape, meta, window, tz adjustments, multi-value dates and null fills", () => {
    const json = {
      tz: "Europe/London",
      window: { from: "2026-09-27", to: "2026-09-29" },
      series: {
        steps: {
          starts: "2026-09-27T00:00:00+02:00\n2026-09-28T00:00:00+02:00\n2026-09-28T00:00:00+02:00",
          values: "1\n2\n3",
        },
        resting_hr: { starts: "2026-09-27", values: "50" },
        cycling_km: { starts: "2026-09-27", values: "10" },
      },
      meta: { shortcut_version: "1", device: "iPhone 15" },
    };
    const n = norm(json, "UTC");
    const s = plain(
      buildSummary(n, {
        unknownFields: collectUnknownFields(json),
        gzip: false,
      }),
    );
    expect(s).toMatchObject({
      shape: "series",
      meta: { shortcut_version: "1", device: "iPhone 15" },
      window: { from: "2026-09-27", to: "2026-09-29" },
      days: 2,
      dateRange: { from: "2026-09-27", to: "2026-09-28" },
      tzAdjustments: 3,
      multiValueDates: { steps: 1 },
      nullFilled: { resting_hr: 1 },
      unknownFields: { cycling_km: { count: 1, types: ["object"] } },
    });
    expect(s.fields!.perDay["2026-09-28"]).toMatchObject({
      present: ["steps"],
      nulls: ["resting_hr"],
    });
    expect(metricsByDate(n)["2026-09-28"]).toEqual({
      steps: 5,
      resting_hr: null,
    });
  });

  it("partialSummary of a rejected series payload uses its window", () => {
    expect(partialSummary({ series: {}, window: { from: "2026-09-26", to: "2026-09-28" } }, {})).toEqual({
      shape: "series",
      days: 3,
      dateRange: { from: "2026-09-26", to: "2026-09-28" },
    });
    expect(partialSummary({ series: "x" }, {})).toEqual({
      shape: "series",
      days: 0,
      dateRange: null,
    });
  });
});
