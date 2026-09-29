/**
 * Second ingest step: everything that needs the user's timezone. Resolves the
 * timezone, pivots a `series` payload into days (./series.ts), enforces the
 * date window, turns hr_hourly timestamps into local hours, parses and
 * cleans sleep segments, and groups them into nights.
 */

import type { MetricName } from "@/lib/health/fields";
import { dict } from "@/lib/ingest/dict";
import type { DayInput, HrRowInput, Issue, ParsedPayload, PayloadMeta, PayloadShape } from "@/lib/ingest/schema";
import { MAX_ISSUES } from "@/lib/ingest/schema";
import { pivotSeries, type SeriesStats } from "@/lib/ingest/series";
import { buildNights, normalizeStage, type Night, type Segment } from "@/lib/ingest/sleep-merge";
import type { SleepStage } from "@/lib/ingest/types";
import { addDays, isValidTimezone, localDateOf, localHourOf, parseTimestamp, todayIn } from "@/lib/tz";

/** Latest accepted date: today + 1 in the user's timezone. */
export const MAX_FUTURE_DAYS = 1;
/** Oldest accepted date: today - 400 (retention is 365 days). */
export const MAX_PAST_DAYS = 400;
/** Segments longer than this are dropped (not a sleep sample). */
export const MAX_SEGMENT_MS = 24 * 60 * 60 * 1000;

export type HrRow = { hour: number; avg: number; min: number | null; max: number | null };

export type NormalizedDay = {
  date: string;
  metrics: Partial<Record<MetricName, number | null>>;
  /** undefined = leave stored rows alone; [] = clear. At most one row per hour, sorted. */
  hrHourly?: HrRow[];
};

export type TzSource = "payload" | "profile" | "default";

export type NormalizedIngest = {
  shape: PayloadShape;
  meta?: PayloadMeta;
  /** Pivot statistics, for the series shape only. */
  series?: SeriesStats;
  tz: string;
  tzSource: TzSource;
  tzIgnored?: string;
  today: string;
  /** Distinct days, sorted by date (duplicates merged: later keys win). */
  days: NormalizedDay[];
  duplicateDates: string[];
  hrDropped: Record<string, number>;
  /** Valid segments (before nap filtering). */
  segments: Segment[];
  nights: Night[];
  napsIgnored: number;
  unknownStages: Record<string, number>;
  droppedSegments: Record<string, number>;
  sleepSources: Record<string, SleepStage[]>;
};

export type NormalizeResult = { ok: true; value: NormalizedIngest } | { ok: false; issues: Issue[]; tz: string };

export type NormalizeContext = { profileTz?: string | null; now?: Date };

/** Payload `tz` if it's a valid IANA zone, else the profile's, else UTC. */
export function resolveTimezone(
  payloadTz: string | undefined,
  profileTz: string | null | undefined,
): { tz: string; source: TzSource; ignored?: string } {
  const ignored = payloadTz !== undefined && !isValidTimezone(payloadTz) ? payloadTz : undefined;
  if (payloadTz !== undefined && !ignored) return { tz: payloadTz, source: "payload" };
  if (profileTz && isValidTimezone(profileTz)) return { tz: profileTz, source: "profile", ignored };
  return { tz: "UTC", source: "default", ignored };
}

/** Accepted local-date window for a user in `tz` at `now`. */
export function dateWindow(tz: string, now: Date = new Date()): { today: string; min: string; max: string } {
  const today = todayIn(tz, now);
  return { today, min: addDays(today, -MAX_PAST_DAYS), max: addDays(today, MAX_FUTURE_DAYS) };
}

const bump = (m: Record<string, number>, k: string, n = 1) => {
  m[k] = (m[k] ?? 0) + n;
};

function mergeDays(days: DayInput[]): { merged: DayInput[]; duplicates: string[] } {
  const byDate = new Map<string, DayInput>();
  const duplicates = new Set<string>();
  for (const d of days) {
    const prev = byDate.get(d.date);
    if (!prev) {
      byDate.set(d.date, { ...d, metrics: { ...d.metrics } });
      continue;
    }
    duplicates.add(d.date);
    Object.assign(prev.metrics, d.metrics);
    if (d.hrHourly !== undefined) prev.hrHourly = d.hrHourly;
  }
  const merged = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { merged, duplicates: [...duplicates].sort() };
}

function resolveHr(
  day: DayInput,
  rows: HrRowInput[],
  tz: string,
  dropped: Record<string, number>,
  issues: Issue[],
): HrRow[] {
  const byHour = new Map<number, HrRow>();
  rows.forEach((r, i) => {
    let hour = r.hour;
    if (r.start !== undefined) {
      const t = parseTimestamp(r.start, tz);
      if (t === null) {
        issues.push({ path: [day.date, "hr_hourly", i, "start"], message: `unparseable timestamp ${JSON.stringify(r.start)}` });
        return;
      }
      if (localDateOf(t, tz) !== day.date) {
        bump(dropped, "other_date");
        return;
      }
      hour = localHourOf(t, tz);
    }
    if (r.avg === null) {
      bump(dropped, "no_avg");
      return;
    }
    if (byHour.has(hour!)) bump(dropped, "duplicate_hour");
    byHour.set(hour!, { hour: hour!, avg: r.avg, min: r.min, max: r.max });
  });
  return [...byHour.values()].sort((a, b) => a.hour - b.hour);
}

/**
 * Validate and normalize against the user's timezone. Dates after today+1 or
 * before today-400 (in that timezone) reject the request; bad sleep/hr rows
 * that are merely out of place are dropped and counted instead.
 */
export function normalizeIngest(payload: ParsedPayload, ctx: NormalizeContext = {}): NormalizeResult {
  const now = ctx.now ?? new Date();
  const { tz, source: tzSource, ignored: tzIgnored } = resolveTimezone(payload.tz, ctx.profileTz);
  const { today, min, max } = dateWindow(tz, now);
  const issues: Issue[] = [];

  let inputDays = payload.days;
  let series: SeriesStats | undefined;
  const hrDropped = dict<number>();
  if (payload.series) {
    const w = payload.series.window;
    if (w && w.to > max) {
      issues.push({ path: ["window", "to"], message: `window.to ${w.to} is after ${max} (today+1 in ${tz})` });
    }
    if (w && w.from < min) {
      issues.push({ path: ["window", "from"], message: `window.from ${w.from} is before ${min} (${MAX_PAST_DAYS} days ago in ${tz})` });
    }
    if (issues.length) return { ok: false, issues, tz };
    const pivot = pivotSeries(payload.series, tz, today);
    if (!pivot.ok) return { ok: false, issues: pivot.issues.slice(0, MAX_ISSUES), tz };
    inputDays = pivot.days;
    series = pivot.stats;
    for (const [k, v] of Object.entries(pivot.stats.hrDropped)) bump(hrDropped, k, v);
  }

  const future = [...new Set(inputDays.map((d) => d.date).filter((d) => d > max))].sort();
  if (future.length) {
    issues.push({
      path: ["date"],
      message: `dates after ${max} (today+1 in ${tz}) are not accepted: ${future.join(", ")}`,
    });
  }
  const old = [...new Set(inputDays.map((d) => d.date).filter((d) => d < min))].sort();
  if (old.length) {
    issues.push({
      path: ["date"],
      message: `dates before ${min} (${MAX_PAST_DAYS} days ago in ${tz}) are not accepted: ${old.join(", ")}`,
    });
  }
  if (issues.length) return { ok: false, issues, tz };

  const { merged, duplicates } = mergeDays(inputDays);
  const days: NormalizedDay[] = merged.map((d) => ({
    date: d.date,
    metrics: d.metrics,
    hrHourly: d.hrHourly === undefined ? undefined : resolveHr(d, d.hrHourly, tz, hrDropped, issues),
  }));

  // Sleep segments.
  const unknownStages = dict<number>();
  const droppedSegments = dict<number>();
  const seen = new Set<string>();
  const segments: Segment[] = [];
  payload.segments.forEach((s, i) => {
    const stage = normalizeStage(s.stage);
    if (!stage) {
      bump(unknownStages, String(s.stage).slice(0, 64));
      return;
    }
    const start = parseTimestamp(s.start, tz);
    const end = parseTimestamp(s.end, tz);
    if (start === null || end === null) {
      const bad = start === null ? ["start", s.start] : ["end", s.end];
      issues.push({ path: ["sleep_segments", i, bad[0]], message: `unparseable timestamp ${JSON.stringify(bad[1])}` });
      return;
    }
    if (end < start) return bump(droppedSegments, "end_before_start");
    if (end - start > MAX_SEGMENT_MS) return bump(droppedSegments, "too_long");
    const key = `${stage}|${start}|${end}|${s.source}`;
    if (seen.has(key)) return bump(droppedSegments, "duplicate");
    seen.add(key);
    segments.push({ stage, start, end, source: s.source });
  });
  if (issues.length) return { ok: false, issues: issues.slice(0, MAX_ISSUES), tz };

  const sleepSources = dict<SleepStage[]>();
  for (const s of segments) {
    const list = (sleepSources[s.source] ??= []);
    if (!list.includes(s.stage)) list.push(s.stage);
  }

  const built = buildNights(segments, tz);
  const nights: Night[] = [];
  for (const n of built.nights) {
    if (n.wakeDate > max) bump(droppedSegments, "future", n.segments.length);
    else if (n.wakeDate < min) bump(droppedSegments, "too_old", n.segments.length);
    else nights.push(n);
  }

  return {
    ok: true,
    value: {
      shape: payload.shape,
      meta: payload.meta,
      series,
      tz,
      tzSource,
      tzIgnored,
      today,
      days,
      duplicateDates: duplicates,
      hrDropped,
      segments,
      nights,
      napsIgnored: built.naps.length,
      unknownStages,
      droppedSegments,
      sleepSources,
    },
  };
}
