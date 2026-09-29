/**
 * What an ingest request contained and changed: the `summary` stored in
 * `ingest_events` and the fields of the per-request log line. Pure.
 */

import { METRIC_NAMES } from "@/lib/health/fields";
import { dict } from "@/lib/ingest/dict";
import type { NormalizedIngest } from "@/lib/ingest/normalize";
import {
  DAY_KEYS,
  detectShape,
  HR_COLUMN_KEYS,
  HR_ROW_KEYS,
  SEGMENT_COLUMN_KEYS,
  SEGMENT_KEYS,
  TOP_KEYS,
} from "@/lib/ingest/schema";
import type { DateRange, FieldInventory, IngestSummary, JsonType, UnknownFieldInfo } from "@/lib/ingest/types";
import { isRealDate } from "@/lib/tz";

export function jsonType(v: unknown): JsonType {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  const t = typeof v;
  return t === "string" || t === "number" || t === "boolean" ? t : "object";
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/** Most distinct unknown keys recorded per request (keeps summaries bounded). */
export const MAX_UNKNOWN_FIELDS = 100;

/**
 * Keys the payload carries that Huddle doesn't know, from the raw JSON (so
 * it works even when validation fails). Day-level keys are recorded by name;
 * other levels get a prefix: `top.x`, `hr_hourly.x`, `sleep_segments.x`.
 */
export function collectUnknownFields(json: unknown): Record<string, UnknownFieldInfo> {
  const out = dict<UnknownFieldInfo>();
  let size = 0;
  const note = (name: string, value: unknown) => {
    let info = out[name];
    if (!info) {
      if (size >= MAX_UNKNOWN_FIELDS) return;
      info = out[name] = { count: 0, types: [] };
      size++;
    }
    info.count++;
    const t = jsonType(value);
    if (!info.types.includes(t)) info.types.push(t);
  };
  const scan = (obj: Record<string, unknown>, known: ReadonlySet<string>, prefix: string) => {
    for (const [k, v] of Object.entries(obj)) if (!known.has(k)) note(prefix + k.slice(0, 100), v);
  };
  const scanHr = (v: unknown) => {
    if (Array.isArray(v)) for (const row of v) if (isObj(row)) scan(row, HR_ROW_KEYS, "hr_hourly.");
    if (isObj(v)) scan(v, HR_COLUMN_KEYS, "hr_hourly.");
  };
  const scanSegments = (v: unknown) => {
    if (Array.isArray(v)) for (const s of v) if (isObj(s)) scan(s, SEGMENT_KEYS, "sleep_segments.");
    if (isObj(v)) scan(v, SEGMENT_COLUMN_KEYS, "sleep_segments.");
  };
  const scanDay = (day: unknown) => {
    if (!isObj(day)) return;
    scan(day, DAY_KEYS, "");
    scanHr(day.hr_hourly);
    scanSegments(day.sleep_segments);
  };

  const shape = detectShape(json);
  if (shape === "object") {
    const top = json as Record<string, unknown>;
    scan(top, TOP_KEYS, "top.");
    if (Array.isArray(top.days)) top.days.forEach(scanDay);
    scanSegments(top.sleep_segments);
  } else if (shape === "array") {
    (json as unknown[]).forEach(scanDay);
  } else if (shape === "day") {
    scanDay(json);
  }
  return out;
}

export function dateRangeOf(dates: readonly string[]): DateRange | null {
  if (dates.length === 0) return null;
  let from = dates[0];
  let to = dates[0];
  for (const d of dates) {
    if (d < from) from = d;
    if (d > to) to = d;
  }
  return { from, to };
}

/** Per-day and total inventory of which known metrics were present, null, or absent. */
export function fieldInventory(days: readonly { date: string; metrics: Record<string, number | null | undefined> }[]) {
  const perDay = dict<FieldInventory>();
  const totals: Record<string, { present: number; nulls: number; absent: number }> = {};
  for (const name of METRIC_NAMES) totals[name] = { present: 0, nulls: 0, absent: 0 };
  for (const day of days) {
    const inv: FieldInventory = { present: [], nulls: [], absent: [] };
    for (const name of METRIC_NAMES) {
      if (!Object.hasOwn(day.metrics, name)) {
        inv.absent.push(name);
        totals[name].absent++;
      } else if (day.metrics[name] === null) {
        inv.nulls.push(name);
        totals[name].nulls++;
      } else {
        inv.present.push(name);
        totals[name].present++;
      }
    }
    perDay[day.date] = inv;
  }
  return { perDay, totals };
}

/**
 * Best-effort summary of a payload that failed validation: day count and
 * date range from whatever `date` values look valid, plus unknown fields.
 */
export function partialSummary(json: unknown, unknownFields: Record<string, UnknownFieldInfo>): IngestSummary {
  const shape = detectShape(json);
  const rawDays: unknown[] =
    shape === "object"
      ? Array.isArray((json as Record<string, unknown>).days)
        ? ((json as Record<string, unknown>).days as unknown[])
        : []
      : shape === "array"
        ? (json as unknown[])
        : shape === "day"
          ? [json]
          : [];
  const dates = rawDays
    .map((d) => (isObj(d) && typeof d.date === "string" && isRealDate(d.date) ? d.date : null))
    .filter((d): d is string => d !== null);
  const summary: IngestSummary = { days: rawDays.length, dateRange: dateRangeOf(dates) };
  if (Object.keys(unknownFields).length) summary.unknownFields = unknownFields;
  return summary;
}

export type SummaryExtras = {
  unknownFields: Record<string, UnknownFieldInfo>;
  gzip: boolean;
  decodedBytes?: number;
  rowsInserted?: number;
  rowsUpdated?: number;
  nightsRecomputed?: string[];
};

/** Summary of a validated (and, when the counts are given, stored) payload. */
export function buildSummary(n: NormalizedIngest, extras: SummaryExtras): IngestSummary {
  const hrDays = n.days.filter((d) => d.hrHourly !== undefined);
  const summary: IngestSummary = {
    days: n.days.length,
    dateRange: dateRangeOf(n.days.map((d) => d.date)),
    fields: fieldInventory(n.days),
    unknownFields: extras.unknownFields,
    hrHourlyCount: hrDays.reduce((acc, d) => acc + d.hrHourly!.length, 0),
    hrHourlyDays: hrDays.length,
    sleepSegmentCount: n.segments.length,
    sleepSources: n.sleepSources,
    nights: n.nights.map((x) => x.wakeDate),
    nightsWritten: n.nights.length,
    napsIgnored: n.napsIgnored,
    tz: n.tz,
    tzSource: n.tzSource,
    gzip: extras.gzip,
  };
  if (n.duplicateDates.length) summary.duplicateDates = n.duplicateDates;
  if (Object.keys(n.hrDropped).length) summary.hrHourlyDropped = n.hrDropped;
  if (Object.keys(n.unknownStages).length) summary.unknownStages = n.unknownStages;
  if (Object.keys(n.droppedSegments).length) summary.droppedSegments = n.droppedSegments;
  if (n.tzIgnored !== undefined) summary.tzIgnored = n.tzIgnored.slice(0, 64);
  if (extras.decodedBytes !== undefined) summary.decodedBytes = extras.decodedBytes;
  if (extras.rowsInserted !== undefined) summary.rowsInserted = extras.rowsInserted;
  if (extras.rowsUpdated !== undefined) summary.rowsUpdated = extras.rowsUpdated;
  if (extras.nightsRecomputed?.length) summary.nightsRecomputed = extras.nightsRecomputed;
  return summary;
}

/** The per-field totals, compacted for the log line: only fields that were present or null somewhere. */
export function compactFieldTotals(summary: IngestSummary): Record<string, { present: number; nulls: number }> {
  const out = dict<{ present: number; nulls: number }>();
  for (const [name, t] of Object.entries(summary.fields?.totals ?? {})) {
    if (t.present || t.nulls) out[name] = { present: t.present, nulls: t.nulls };
  }
  return out;
}
