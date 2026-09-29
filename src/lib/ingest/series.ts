/**
 * Pivoting the `series` payload shape into per-day records.
 *
 * A Shortcut that runs ONE "Find Health Samples" per metric over a whole
 * window, grouped by day (or by hour for heart rate), gets a list of group
 * start dates and a list of values. It sends them as newline-joined columns;
 * this turns them into the same `DayInput`s the other shapes produce, so
 * everything after (date rules, upsert, summary, scores) is shared.
 *
 * Rules (documented in docs/ingest-api.md, "Series"):
 * - A day group's start maps to its local date in the user's timezone. A
 *   series whose starts ALL lie within 2 hours of a local midnight is taken
 *   to be day-grouped in a slightly different timezone (a phone abroad
 *   sending offsets, say): each start is rounded to the nearest midnight,
 *   and every start that wasn't exactly midnight counts as a tz adjustment.
 *   Other series (ungrouped samples) use the plain local date.
 * - With a `window`, only its dates are built; rows outside it are dropped
 *   and counted (the first group of a rolling "last N days" query is a
 *   partial day). A metric series that was sent but has no row for a window
 *   date means "Health had nothing": that date gets an explicit null, but
 *   only up to yesterday (today may still be syncing from the wearable).
 *   Metrics not sent are left alone. Without a window there is no null fill.
 * - Several rows for one date (the Shortcut forgot "Group By"): cumulative
 *   metrics are summed, discrete ones averaged (`aggregation` in fields.ts).
 * - `hr` rows map to (local date, local hour); dates with at least one row
 *   (with an `avg`) get their hourly rows replaced, others are untouched.
 *
 * Pure: no database, `today` is passed in.
 */

import { getMetricField, type MetricName } from "@/lib/health/fields";
import { dict } from "@/lib/ingest/dict";
import {
  MAX_DAYS,
  normalizeMetricValue,
  type DayInput,
  type HrRowInput,
  type Issue,
  type SeriesInput,
} from "@/lib/ingest/schema";
import type { DateRange } from "@/lib/ingest/types";
import { addDays, daysBetween, localDateOf, localHourOf, localParts, parseLocalDate, parseTimestamp } from "@/lib/tz";

/** A day-group start this close to a local midnight is rounded to it (tz mismatch guard). */
export const MIDNIGHT_TOLERANCE_MIN = 120;

export type SeriesStats = {
  window?: DateRange;
  /** Day-group starts that weren't at local midnight and were rounded to the nearest one. */
  tzAdjustments: number;
  /** Per metric: dates that had more than one row (summed or averaged). */
  multiValueDates: Record<string, number>;
  /** Per metric: window dates (up to yesterday) set to null because the series had no row for them. */
  nullFilled: Record<string, number>;
  /** Per metric (and `hr`): rows dropped because their date is outside the window. */
  outsideWindow: Record<string, number>;
  /** hr rows dropped before per-day handling (`no_avg`). */
  hrDropped: Record<string, number>;
};

export type PivotResult = { ok: true; days: DayInput[]; stats: SeriesStats } | { ok: false; issues: Issue[] };

type Resolved = { date: string; minutes: number | null };

/**
 * Local date of a group start, plus minutes past local midnight (null for a
 * plain date). Null when unparseable.
 */
function resolveStart(start: string, tz: string): Resolved | null {
  const date = parseLocalDate(start);
  if (date) return { date, minutes: null };
  const t = parseTimestamp(start, tz);
  if (t === null) return null;
  const p = localParts(t, tz);
  return {
    date: localDateOf(t, tz),
    minutes: p.hour * 60 + p.minute + p.second / 60,
  };
}

const nearMidnight = (r: Resolved) =>
  r.minutes === null || r.minutes <= MIDNIGHT_TOLERANCE_MIN || r.minutes >= 1440 - MIDNIGHT_TOLERANCE_MIN;

/** Map a whole series' starts to local dates, applying the midnight rounding when it's day-grouped. */
export function seriesDates(starts: readonly string[], tz: string): { dates: (string | null)[]; adjustments: number } {
  const resolved = starts.map((s) => resolveStart(s, tz));
  const dayGrouped = resolved.every((r) => r === null || nearMidnight(r));
  let adjustments = 0;
  const dates = resolved.map((r) => {
    if (r === null) return null;
    if (!dayGrouped || r.minutes === null || r.minutes === 0) return r.date;
    adjustments++;
    return r.minutes >= 1440 - MIDNIGHT_TOLERANCE_MIN ? addDays(r.date, 1) : r.date;
  });
  return { dates, adjustments };
}

function datesOf(w: DateRange): string[] {
  const n = daysBetween(w.from, w.to) + 1;
  return Array.from({ length: n }, (_, i) => addDays(w.from, i));
}

const bump = (m: Record<string, number>, k: string, n = 1) => {
  m[k] = (m[k] ?? 0) + n;
};

/**
 * Combine one date's rows for `name`. Values were range-checked one by one at
 * parse time; a sum can still end up out of range (an error).
 */
function combine(name: MetricName, values: (number | null)[]): number | null | string {
  const nums = values.filter((v): v is number => v !== null);
  if (nums.length === 0) return null;
  if (nums.length === 1) return nums[0];
  const field = getMetricField(name);
  const total = nums.reduce((a, b) => a + b, 0);
  const combined = field.aggregation === "sum" ? total : total / nums.length;
  // Fractions were already converted per value: only round and range-check.
  return normalizeMetricValue({ ...field, fraction: false }, combined);
}

/** Turn a parsed series payload into days, in the user's timezone. `today` is today's local date there. */
export function pivotSeries(series: SeriesInput, tz: string, today: string): PivotResult {
  const issues: Issue[] = [];
  const { window } = series;
  const inWindow = (d: string) => !window || (d >= window.from && d <= window.to);
  const yesterday = addDays(today, -1);
  const stats: SeriesStats = {
    window,
    tzAdjustments: 0,
    multiValueDates: dict<number>(),
    nullFilled: dict<number>(),
    outsideWindow: dict<number>(),
    hrDropped: dict<number>(),
  };

  // Metric rows by date.
  const byMetric = new Map<MetricName, Map<string, (number | null)[]>>();
  for (const [name, col] of Object.entries(series.metrics) as [MetricName, NonNullable<SeriesInput["metrics"][MetricName]>][]) {
    const { dates, adjustments } = seriesDates(col.starts, tz);
    stats.tzAdjustments += adjustments;
    const byDate = new Map<string, (number | null)[]>();
    dates.forEach((date, i) => {
      if (date === null) {
        issues.push({
          path: ["series", name, "starts", i],
          message: `unparseable timestamp or date ${JSON.stringify(col.starts[i])}`,
        });
        return;
      }
      if (!inWindow(date)) return bump(stats.outsideWindow, name);
      const list = byDate.get(date);
      if (list) list.push(col.values[i]);
      else byDate.set(date, [col.values[i]]);
    });
    byMetric.set(name, byDate);
  }

  // Hourly heart rate by date (hour groups: no midnight rounding, the local hour is the floor).
  const hrByDate = new Map<string, HrRowInput[]>();
  series.hr.forEach((r, i) => {
    const t = parseTimestamp(r.start!, tz);
    if (t === null) {
      issues.push({
        path: ["hr", "starts", i],
        message: `unparseable timestamp ${JSON.stringify(r.start)}`,
      });
      return;
    }
    const date = localDateOf(t, tz);
    if (!inWindow(date)) return bump(stats.outsideWindow, "hr");
    if (r.avg === null) return bump(stats.hrDropped, "no_avg");
    const row: HrRowInput = {
      hour: localHourOf(t, tz),
      avg: r.avg,
      min: r.min,
      max: r.max,
    };
    const list = hrByDate.get(date);
    if (list) list.push(row);
    else hrByDate.set(date, [row]);
  });
  if (issues.length) return { ok: false, issues };

  // Which dates to build.
  let dates: string[];
  if (window) {
    dates = datesOf(window);
  } else {
    const all = new Set<string>(hrByDate.keys());
    for (const byDate of byMetric.values()) for (const d of byDate.keys()) all.add(d);
    dates = [...all].sort();
    if (dates.length > MAX_DAYS) {
      return {
        ok: false,
        issues: [
          {
            path: ["series"],
            message: `at most ${MAX_DAYS} days per request (the series cover ${dates.length}); send a window`,
          },
        ],
      };
    }
  }

  const days: DayInput[] = [];
  for (const date of dates) {
    const metrics: DayInput["metrics"] = {};
    for (const [name, byDate] of byMetric) {
      const rows = byDate.get(date);
      if (rows) {
        if (rows.length > 1) bump(stats.multiValueDates, name);
        const v = combine(name, rows);
        if (typeof v === "string") {
          issues.push({
            path: ["series", name],
            message: `${date}: ${rows.length} values combined are ${v}`,
          });
          continue;
        }
        metrics[name] = v;
      } else if (window && date <= yesterday) {
        metrics[name] = null;
        bump(stats.nullFilled, name);
      }
    }
    const hr = hrByDate.get(date);
    if (Object.keys(metrics).length === 0 && !hr) continue;
    days.push({ date, metrics, hrHourly: hr, segments: [] });
  }
  if (issues.length) return { ok: false, issues };
  return { ok: true, days, stats };
}
