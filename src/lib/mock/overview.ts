/**
 * Mock Overview data for UI development. Fully deterministic (seeded PRNG,
 * fixed dates, pre-formatted labels) so server and client renders match.
 */

import type { HourPoint } from "@/components/charts/HourBars";
import type { SleepSegment } from "@/components/charts/Hypnogram";
import type { SleepStage } from "@/lib/ui/colors";

export type KeyStat = {
  id: string;
  label: string;
  value: number;
  baseline: number;
  unit?: string;
  decimals?: number;
  higherIsBetter: boolean;
  /** Pre-formatted text for non-decimal values like hours. */
  display?: string;
  baselineDisplay?: string;
};

export type OverviewDay = {
  id: string;
  /** "TODAY", "YESTERDAY", "SAT"… */
  title: string;
  /** Mono sub-line, e.g. "MON · SEP 28". */
  dateLabel: string;
  recovery: number;
  strain: number;
  sleep: number;
  hrv: number;
  stats: KeyStat[];
  hourly: HourPoint[];
  avgHr: number;
  maxHr: number;
  sleepSegments: SleepSegment[];
  bedtime: string;
  wake: string;
  inBed: string;
  asleep: string;
  syncedLabel: string;
};

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Plausible hourly HR ranges; hours after `nowHour` are null (not yet lived). */
function hourly(seed: number, nowHour: number): HourPoint[] {
  const r = mulberry32(seed);
  return Array.from({ length: 24 }, (_, h) => {
    if (h > nowHour) return null;
    const asleep = h < 7;
    const workout = h === 7 || h === 18;
    const base = asleep ? 50 + r() * 6 : 64 + r() * 14;
    const spread = asleep ? 6 + r() * 6 : workout ? 70 + r() * 20 : 18 + r() * 22;
    const min = Math.round(base - 4);
    const max = Math.round(base + spread);
    const avg = Math.round(min + (max - min) * (workout ? 0.55 : 0.3 + r() * 0.15));
    return { hour: h, min, max, avg };
  });
}

/** ~90-minute cycles: deep front-loaded, REM growing toward morning. */
function night(seed: number, totalMin: number): SleepSegment[] {
  const r = mulberry32(seed);
  const segs: SleepSegment[] = [];
  let t = 0;
  const push = (stage: SleepStage, len: number) => {
    const end = Math.min(t + Math.max(3, Math.round(len)), totalMin);
    if (end > t) segs.push({ stage, start: t, end });
    t = end;
  };
  push("awake", 6 + r() * 8);
  let cycle = 0;
  while (t < totalMin - 10) {
    const deepLen = Math.max(4, 42 - cycle * 11 + r() * 10);
    const remLen = 8 + cycle * 7 + r() * 8;
    push("core", 14 + r() * 12);
    push("deep", deepLen);
    push("core", 16 + r() * 14);
    push("rem", remLen);
    if (r() > 0.55) push("awake", 2 + r() * 5);
    cycle++;
  }
  push("awake", totalMin - t);
  return segs;
}

function hm(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return `${h}:${String(m).padStart(2, "0")}`;
}

type DaySeed = {
  id: string;
  title: string;
  dateLabel: string;
  recovery: number;
  strain: number;
  sleep: number;
  rhr: number;
  hrv: number;
  resp: number;
  sleepMin: number;
  steps: number;
  kcal: number;
  nowHour: number;
  bedtime: string;
  wake: string;
  inBedMin: number;
  syncedLabel: string;
};

const BASE = { rhr: 54, hrv: 62, resp: 15.2, sleepMin: 442, steps: 9840, kcal: 2710 };

const SEEDS: DaySeed[] = [
  {
    id: "2026-09-28",
    title: "Today",
    dateLabel: "MON · SEP 28",
    recovery: 78,
    strain: 11.4,
    sleep: 86,
    rhr: 51,
    hrv: 71,
    resp: 14.8,
    sleepMin: 431,
    steps: 7412,
    kcal: 1984,
    nowHour: 14,
    bedtime: "11:42 PM",
    wake: "7:18 AM",
    inBedMin: 456,
    syncedLabel: "Synced 12 min ago",
  },
  {
    id: "2026-09-27",
    title: "Yesterday",
    dateLabel: "SUN · SEP 27",
    recovery: 52,
    strain: 16.8,
    sleep: 71,
    rhr: 56,
    hrv: 55,
    resp: 15.6,
    sleepMin: 398,
    steps: 14210,
    kcal: 3320,
    nowHour: 23,
    bedtime: "12:26 AM",
    wake: "7:34 AM",
    inBedMin: 428,
    syncedLabel: "Synced Sun 11:48 PM",
  },
  {
    id: "2026-09-26",
    title: "Saturday",
    dateLabel: "SAT · SEP 26",
    recovery: 24,
    strain: 18.9,
    sleep: 58,
    rhr: 61,
    hrv: 41,
    resp: 16.4,
    sleepMin: 342,
    steps: 17960,
    kcal: 3810,
    nowHour: 23,
    bedtime: "1:14 AM",
    wake: "7:22 AM",
    inBedMin: 368,
    syncedLabel: "Synced Sat 11:52 PM",
  },
];

function build(d: DaySeed, i: number): OverviewDay {
  const hours = hourly(1000 + i * 17, d.nowHour);
  const present = hours.filter((h): h is NonNullable<HourPoint> => h !== null);
  return {
    id: d.id,
    title: d.title,
    dateLabel: d.dateLabel,
    recovery: d.recovery,
    strain: d.strain,
    sleep: d.sleep,
    hrv: d.hrv,
    hourly: hours,
    avgHr: Math.round(present.reduce((s, h) => s + h.avg, 0) / present.length),
    maxHr: Math.max(...present.map((h) => h.max)),
    sleepSegments: night(77 + i * 31, d.inBedMin),
    bedtime: d.bedtime,
    wake: d.wake,
    inBed: hm(d.inBedMin),
    asleep: hm(d.sleepMin),
    syncedLabel: d.syncedLabel,
    stats: [
      { id: "rhr", label: "Resting HR", value: d.rhr, baseline: BASE.rhr, unit: "bpm", higherIsBetter: false },
      { id: "hrv", label: "HRV", value: d.hrv, baseline: BASE.hrv, unit: "ms", higherIsBetter: true },
      { id: "resp", label: "Resp. rate", value: d.resp, baseline: BASE.resp, unit: "rpm", decimals: 1, higherIsBetter: false },
      {
        id: "sleep",
        label: "Sleep",
        value: d.sleepMin / 60,
        baseline: BASE.sleepMin / 60,
        unit: "hr",
        decimals: 1,
        higherIsBetter: true,
        display: hm(d.sleepMin),
        baselineDisplay: hm(BASE.sleepMin),
      },
      { id: "steps", label: "Steps", value: d.steps, baseline: BASE.steps, higherIsBetter: true },
      { id: "kcal", label: "Calories", value: d.kcal, baseline: BASE.kcal, unit: "kcal", higherIsBetter: true },
    ],
  };
}

/** Index 0 = today, then going back in time. */
export const overviewDays: OverviewDay[] = SEEDS.map(build);

/** 14-day series for sparklines / trend demos. */
export const recoveryTrend = [64, 71, 58, 44, 69, 82, 77, 61, 38, 52, 73, 24, 52, 78];
export const hrvTrend = [58, 63, 55, 49, 61, 70, 68, 60, 47, 52, 66, 41, 55, 71];
export const strainTrend = [9.8, 14.2, 12.1, 17.4, 8.2, 11.9, 15.6, 13.3, 19.1, 10.4, 12.8, 18.9, 16.8, 11.4];
export const trendLabels = ["T", "W", "T", "F", "S", "S", "M", "T", "W", "T", "F", "S", "S", "M"];
