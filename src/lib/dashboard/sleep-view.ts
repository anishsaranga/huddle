/**
 * Sleep detail view helpers (pure): stage breakdown and the 7-night
 * bedtime → wake chart, pre-computed in the user's timezone.
 */

import { addDays, localParts } from "@/lib/tz";
import { weekdayShort } from "@/lib/dashboard/dates";
import { formatAxisHour, formatClock } from "@/lib/dashboard/format";
import type { NightWindow, OverviewNight } from "@/lib/scores/queries";
import type { SleepStage } from "@/lib/ui/colors";

export type StageRow = { stage: SleepStage; minutes: number; pct: number };

/** Minutes and share of each stage (share of all staged time, awake included). */
export function stageBreakdown(n: Pick<OverviewNight, "awakeMin" | "remMin" | "coreMin" | "deepMin">): StageRow[] {
  const rows: [SleepStage, number][] = [
    ["awake", n.awakeMin ?? 0],
    ["rem", n.remMin ?? 0],
    ["core", n.coreMin ?? 0],
    ["deep", n.deepMin ?? 0],
  ];
  const total = rows.reduce((a, [, m]) => a + m, 0);
  return rows.map(([stage, minutes]) => ({
    stage,
    minutes: Math.round(minutes),
    pct: total > 0 ? Math.round((minutes / total) * 100) : 0,
  }));
}

/** Minutes after 18:00 local (so an evening bedtime and the next morning's wake sit on one axis). */
const ANCHOR = 18 * 60;
function eveningMinutes(ms: number, tz: string): number {
  const p = localParts(ms, tz);
  return (((p.hour * 60 + p.minute - ANCHOR) % 1440) + 1440) % 1440;
}

export type BedtimeRow = {
  date: string;
  label: string;
  /** Minutes after 18:00 (null = no night recorded). */
  bed: number | null;
  wake: number | null;
  bedLabel: string | null;
  wakeLabel: string | null;
  current: boolean;
};

export type BedtimeChart = {
  rows: BedtimeRow[];
  /** Axis range in minutes after 18:00. */
  lo: number;
  hi: number;
  ticks: { t: number; label: string }[];
  /** Mean bed / wake over the nights shown (minutes after 18:00). */
  meanBed: number | null;
  meanWake: number | null;
};

/** The 7 nights ending on `date` (oldest first), as floating bed → wake bars. */
export function bedtimeChart(nights: readonly NightWindow[], date: string, tz: string, h12: boolean): BedtimeChart {
  const byDate = new Map(nights.map((n) => [n.wakeDate, n]));
  const rows: BedtimeRow[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = addDays(date, -i);
    const n = byDate.get(d);
    rows.push({
      date: d,
      label: weekdayShort(d),
      bed: n ? eveningMinutes(n.bedStart.getTime(), tz) : null,
      wake: n ? eveningMinutes(n.bedEnd.getTime(), tz) : null,
      bedLabel: n ? formatClock(n.bedStart.getTime(), tz, h12) : null,
      wakeLabel: n ? formatClock(n.bedEnd.getTime(), tz, h12) : null,
      current: d === date,
    });
  }
  const beds = rows.map((r) => r.bed).filter((v): v is number => v !== null);
  const wakes = rows.map((r) => r.wake).filter((v): v is number => v !== null);
  const mean = (vs: number[]) => (vs.length ? Math.round(vs.reduce((a, b) => a + b, 0) / vs.length) : null);
  // Whole hours, at least 22:00 → 08:00, padded by 30 min.
  let lo = Math.floor((Math.min(240, ...beds) - 30) / 60) * 60;
  let hi = Math.ceil((Math.max(840, ...wakes) + 30) / 60) * 60;
  lo = Math.max(0, lo);
  hi = Math.min(1440, hi);
  const ticks: { t: number; label: string }[] = [];
  const step = hi - lo > 720 ? 240 : 120;
  for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) {
    ticks.push({ t, label: formatAxisHour((ANCHOR + t) / 60, h12) });
  }
  return { rows, lo, hi, ticks, meanBed: mean(beds), meanWake: mean(wakes) };
}
