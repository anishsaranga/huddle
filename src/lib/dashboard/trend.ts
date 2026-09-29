/**
 * Trend series for the detail screens' 1W / 1M / 6M toggles, all derived from
 * one 182-day `getTrend` result ending at the screen's date (so a single query
 * feeds every range). 6M is shown as 26 weekly means: 182 daily bars don't fit
 * a phone.
 */

import { shortDate, weekdayShort } from "@/lib/dashboard/dates";
import type { TrendPoint, TrendRange } from "@/lib/scores/queries";

export type TrendBarView = {
  key: string;
  /** Axis label ("" = unlabeled). */
  label: string;
  /** Readout title when the bar is selected, e.g. "MON · SEP 28" or "WEEK OF SEP 7". */
  title: string;
  value: number | null;
  /** Per-bar color (recovery bands); omitted = the chart's color. */
  color?: string;
};

export type TrendSeries = Record<TrendRange, TrendBarView[]>;

const mean = (vs: number[]): number | null => (vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null);
const round1 = (v: number) => Math.round(v * 10) / 10;

export function buildTrendSeries(points: readonly TrendPoint[], colorOf?: (v: number) => string): TrendSeries {
  const color = (v: number | null) => (v !== null && colorOf ? { color: colorOf(v) } : {});

  const week = points.slice(-7).map((p) => ({
    key: p.date,
    label: weekdayShort(p.date),
    title: `${weekdayShort(p.date)} · ${shortDate(p.date)}`,
    value: p.value,
    ...color(p.value),
  }));

  const monthPts = points.slice(-30);
  const month = monthPts.map((p, i) => ({
    key: p.date,
    // Label the last day and every 7th before it.
    label: (monthPts.length - 1 - i) % 7 === 0 ? shortDate(p.date) : "",
    title: `${weekdayShort(p.date)} · ${shortDate(p.date)}`,
    value: p.value,
    ...color(p.value),
  }));

  // 26 weeks, the last one ending on the screen's date.
  const six: TrendBarView[] = [];
  const pts = points.slice(-182);
  const chunks: TrendPoint[][] = [];
  for (let end = pts.length; end > 0; end -= 7) chunks.unshift(pts.slice(Math.max(0, end - 7), end));
  for (const c of chunks) {
    const m = mean(c.map((p) => p.value).filter((v): v is number => v !== null));
    const value = m === null ? null : round1(m);
    // Month names sit on the week that contains the 1st.
    const first = c.find((p) => p.date.endsWith("-01"));
    six.push({
      key: c[0].date,
      label: first ? shortDate(first.date).split(" ")[0] : "",
      title: `WEEK OF ${shortDate(c[0].date)}`,
      value,
      ...color(value),
    });
  }

  return { "1w": week, "1m": month, "6m": six };
}

/** Mean of the non-null values among the last `n` points (null when none). */
export function recentAverage(points: readonly TrendPoint[], n = 30): number | null {
  const m = mean(points.slice(-n).map((p) => p.value).filter((v): v is number => v !== null));
  return m === null ? null : round1(m);
}
