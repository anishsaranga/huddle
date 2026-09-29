import { describe, expect, it } from "vitest";
import { METRIC_NAMES } from "@/lib/health/fields";
import { normalizeIngest } from "@/lib/ingest/normalize";
import { parsePayload } from "@/lib/ingest/schema";
import { REDACTED, scrubSecrets } from "@/lib/ingest/scrub";
import {
  buildSummary,
  collectUnknownFields,
  compactFieldTotals,
  fieldInventory,
  partialSummary,
} from "@/lib/ingest/summary";

const NOW = new Date("2026-09-29T12:00:00Z");
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v));

describe("collectUnknownFields", () => {
  it("records unknown keys at every level with counts and value types", () => {
    const json = {
      days: [
        {
          date: "2026-09-28",
          steps: 1,
          cycling_km: 12.5,
          mood: "good",
          hr_hourly: [{ hour: 1, avg: 50, zone: 2 }],
          sleep_segments: { stages: "", starts: "", ends: "", device_model: "Watch7,1" },
        },
        { date: "2026-09-27", cycling_km: "3", mood: null },
      ],
      sleep_segments: [{ stage: "Core", start: "a", end: "b", confidence: 0.9 }],
      tz: "UTC",
      shortcut_version: "1.2",
      key: "gk_x",
    };
    expect(plain(collectUnknownFields(json))).toEqual({
      "top.shortcut_version": { count: 1, types: ["string"] },
      "top.key": { count: 1, types: ["string"] },
      cycling_km: { count: 2, types: ["number", "string"] },
      mood: { count: 2, types: ["string", "null"] },
      "hr_hourly.zone": { count: 1, types: ["number"] },
      "sleep_segments.device_model": { count: 1, types: ["string"] },
      "sleep_segments.confidence": { count: 1, types: ["number"] },
    });
  });

  it("works for the single-day and array shapes, and tolerates junk", () => {
    expect(Object.keys(collectUnknownFields({ date: "2026-09-28", x: [] }))).toEqual(["x"]);
    expect(plain(collectUnknownFields([{ date: "2026-09-28", x: {} }, 5, null]))).toEqual({ x: { count: 1, types: ["object"] } });
    expect(Object.keys(collectUnknownFields("nope"))).toEqual([]);
    // Prototype-ish names are just names.
    const weird = collectUnknownFields(JSON.parse('{"date":"2026-09-28","__proto__":1,"constructor":2}'));
    expect(Object.keys(weird).sort()).toEqual(["__proto__", "constructor"]);
    expect(({} as Record<string, unknown>).count).toBeUndefined();
  });
});

describe("fieldInventory", () => {
  it("splits known metrics into present / null / absent per day, with totals", () => {
    const inv = fieldInventory([
      { date: "2026-09-28", metrics: { steps: 5, resting_hr: null } },
      { date: "2026-09-27", metrics: { steps: 1 } },
    ]);
    expect(inv.perDay["2026-09-28"].present).toEqual(["steps"]);
    expect(inv.perDay["2026-09-28"].nulls).toEqual(["resting_hr"]);
    expect(inv.perDay["2026-09-28"].absent).toHaveLength(METRIC_NAMES.length - 2);
    expect(inv.totals.steps).toEqual({ present: 2, nulls: 0, absent: 0 });
    expect(inv.totals.resting_hr).toEqual({ present: 0, nulls: 1, absent: 1 });
    expect(inv.totals.vo2max).toEqual({ present: 0, nulls: 0, absent: 2 });
  });
});

describe("buildSummary", () => {
  it("summarizes a normalized payload", () => {
    const json = {
      tz: "Europe/Berlin",
      days: [
        { date: "2026-09-28", steps: "8,000", hrv_sdnn_ms: null, hr_hourly: [{ hour: 1, avg: 50 }, { hour: 2, avg: 52 }], extra: 1 },
        { date: "2026-09-27", steps: 7000 },
        { date: "2026-09-27", resting_hr: 51 },
      ],
      sleep_segments: [
        { stage: "Core", start: "2026-09-27T23:00:00+02:00", end: "2026-09-28T06:00:00+02:00", source: "Watch" },
        { stage: "In Bed", start: "2026-09-27T22:50:00+02:00", end: "2026-09-28T06:10:00+02:00", source: "iPhone" },
        { stage: "Nap-ish", start: "2026-09-28T13:00:00+02:00", end: "2026-09-28T13:20:00+02:00", source: "Watch" },
      ],
    };
    const parsed = parsePayload(json);
    if (!parsed.ok) throw new Error();
    const n = normalizeIngest(parsed.payload, { now: NOW });
    if (!n.ok) throw new Error();
    const s = plain(
      buildSummary(n.value, {
        unknownFields: collectUnknownFields(json),
        gzip: true,
        decodedBytes: 1234,
        rowsInserted: 1,
        rowsUpdated: 1,
      }),
    );
    expect(s).toMatchObject({
      days: 2,
      dateRange: { from: "2026-09-27", to: "2026-09-28" },
      unknownFields: { extra: { count: 1, types: ["number"] } },
      duplicateDates: ["2026-09-27"],
      hrHourlyCount: 2,
      hrHourlyDays: 1,
      sleepSegmentCount: 2,
      sleepSources: { Watch: ["core"], iPhone: ["in_bed"] },
      unknownStages: { "Nap-ish": 1 },
      nights: ["2026-09-28"],
      nightsWritten: 1,
      napsIgnored: 0,
      rowsInserted: 1,
      rowsUpdated: 1,
      tz: "Europe/Berlin",
      tzSource: "payload",
      gzip: true,
      decodedBytes: 1234,
    });
    expect(s.fields!.perDay["2026-09-27"].present).toEqual(["steps", "resting_hr"]);
    expect(s.fields!.perDay["2026-09-28"].nulls).toEqual(["hrv_sdnn_ms"]);
    expect(plain(compactFieldTotals(s))).toEqual({
      steps: { present: 2, nulls: 0 },
      resting_hr: { present: 1, nulls: 0 },
      hrv_sdnn_ms: { present: 0, nulls: 1 },
    });
  });

  it("partialSummary uses whatever dates look valid", () => {
    const s = partialSummary({ days: [{ date: "2026-09-28" }, { date: "bad" }, { date: "2026-09-20", steps: "x" }, 7] }, {});
    expect(s).toEqual({ days: 4, dateRange: { from: "2026-09-20", to: "2026-09-28" } });
    expect(partialSummary("x", {})).toEqual({ days: 0, dateRange: null });
  });
});

describe("scrubSecrets", () => {
  const KEY = `gk_${"A".repeat(43)}`;

  it("redacts credential-named fields, the request key anywhere, and key-shaped strings", () => {
    const out = scrubSecrets(
      {
        key: KEY,
        api_key: "x",
        Authorization: "Bearer y",
        days: [{ date: "2026-09-28", note: `my key is ${KEY}!`, token: 1, other: `gk_${"B".repeat(30)}` }],
        [KEY]: 1,
      },
      KEY,
    );
    const text = JSON.stringify(out);
    expect(text).not.toContain("AAAAAAAAAAAAAAAA");
    expect(text).not.toContain("BBBBBBBBBBBBBBBB");
    expect(out).toMatchObject({
      key: REDACTED,
      api_key: REDACTED,
      Authorization: REDACTED,
      days: [{ date: "2026-09-28", note: `my key is ${REDACTED}!`, token: REDACTED, other: REDACTED }],
    });
  });

  it("can leave field names alone (for summaries) and cuts off deep nesting", () => {
    expect(scrubSecrets({ key: { count: 1 } }, undefined, false)).toEqual({ key: { count: 1 } });
    let deep: unknown = "x";
    for (let i = 0; i < 100; i++) deep = [deep];
    expect(JSON.stringify(scrubSecrets(deep))).toContain("[TOO DEEP]");
  });
});
