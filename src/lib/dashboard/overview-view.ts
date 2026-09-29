/**
 * Home ("Overview") view model: turns `getOverview` + `getDataSpan` into
 * plain, serializable, pre-formatted props for the client Overview (so all
 * timezone work happens once, on the server, in the user's zone).
 */

import type { HourPoint } from "@/components/charts/HourBars";
import { currentHourFor, dayNav, daySubtitle, dayTitle } from "@/lib/dashboard/dates";
import { recoveryNullReason, sleepNullReason, strainNullReason, type DeviceFacts } from "@/lib/dashboard/explain";
import { deviceName, formatClock, formatDuration, formatHm, formatInt } from "@/lib/dashboard/format";
import type { KeyStat, Overview, OverviewSegment } from "@/lib/scores/queries";
import type { RecoveryBand } from "@/lib/scores/recovery";
import type { HourRow } from "@/lib/scores/types";
import { NEUTRAL_SIGNAL, recoveryColor, SIGNAL, type SleepStage } from "@/lib/ui/colors";
import { formatNumber } from "@/lib/ui/format";

export type DialView = {
  value: number | null;
  /** Tiny ALL-CAPS reason under a null dial. */
  reason: string | null;
  limited: boolean;
  /** Today's strain: still accumulating. */
  live: boolean;
  color: string;
};

export type StatView = {
  key: KeyStat["key"];
  label: string;
  value: number;
  display: string;
  unit: string;
  baseline?: number;
  baselineDisplay?: string;
  decimals: number;
  higherIsBetter: boolean;
  note?: string;
  showDelta: boolean;
};

export type StrainCardView = {
  strain: number | null;
  hours: HourPoint[];
  nowHour: number | null;
  avgHr: number | null;
  maxHr: number | null;
  /** Minutes in zones 1-5 (null without HR). */
  zones: number[] | null;
  activeKcal: number | null;
  exerciseMin: number | null;
  steps: number | null;
};

export type TimeSegment = { stage: SleepStage; start: number; end: number };
export type TimelineBlock = { asleep: boolean; start: number; end: number };

export type SleepCardView =
  | { kind: "stages"; segments: TimeSegment[]; asleep: string; inBed: string | null; efficiency: number | null; bed: string; wake: string; source: string }
  | { kind: "timeline"; blocks: TimelineBlock[]; asleep: string; bed: string; wake: string; source: string; device: string }
  | { kind: "in_bed"; inBed: string; bed: string; wake: string; source: string; device: string }
  | { kind: "none"; message: string };

export type OverviewView = {
  date: string;
  today: string;
  title: string;
  dateLabel: string;
  prev: string | null;
  next: string | null;
  isToday: boolean;
  h12: boolean;
  glow: string;
  band: RecoveryBand | null;
  recovery: DialView;
  strain: DialView;
  sleep: DialView;
  stats: StatView[];
  strainCard: StrainCardView;
  sleepCard: SleepCardView;
  /** ISO time of the last successful sync (null = never). */
  lastSyncAt: string | null;
  /** Server clock at render (ms), so the first client render of "N min ago" matches. */
  renderedAt: number;
};

type Ctx = {
  today: string;
  tz: string;
  h12: boolean;
  facts: DeviceFacts;
  firstDate: string | null;
  now: Date;
};

const STAT_LABEL: Record<KeyStat["key"], string> = {
  resting_hr: "Resting HR",
  hrv_sdnn_ms: "HRV",
  resp_rate: "Resp. rate",
  sleep_duration: "Sleep",
  steps: "Steps",
  active_kcal: "Active calories",
};
const STAT_UNIT: Record<KeyStat["key"], string> = {
  resting_hr: "bpm",
  hrv_sdnn_ms: "ms",
  resp_rate: "rpm",
  sleep_duration: "hrs",
  steps: "",
  active_kcal: "kcal",
};
const STAT_DECIMALS: Record<KeyStat["key"], number> = {
  resting_hr: 0,
  hrv_sdnn_ms: 0,
  resp_rate: 1,
  sleep_duration: 0,
  steps: 0,
  active_kcal: 0,
};

function fmtStat(key: KeyStat["key"], v: number): string {
  if (key === "sleep_duration") return formatHm(v);
  if (key === "steps" || key === "active_kcal") return formatInt(v);
  return formatNumber(v, STAT_DECIMALS[key]);
}

/**
 * Key stats rows. Vitals only for users whose device ever sent them, rows with
 * no recent history left out; today's activity totals are "so far" with no
 * delta (a partial day vs full-day averages would always read as "below").
 */
export function statViews(stats: readonly KeyStat[], o: { isToday: boolean; facts: DeviceFacts }): StatView[] {
  return stats
    .filter((s) => {
      if (s.key === "hrv_sdnn_ms") return o.facts.hasHrv;
      if (s.key === "resp_rate") return o.facts.hasResp;
      if (s.key === "resting_hr") return o.facts.hasRhr;
      // Nothing today and nothing in the last 30 days (e.g. sleep on a phone-only setup): leave the row out.
      return s.value !== null || s.baseline !== null || s.n > 0;
    })
    .map((s) => {
      const partial = o.isToday && (s.key === "steps" || s.key === "active_kcal");
      const hasValue = s.value !== null;
      return {
        key: s.key,
        label: STAT_LABEL[s.key],
        value: s.value ?? 0,
        display: hasValue ? fmtStat(s.key, s.value!) : "—",
        unit: STAT_UNIT[s.key],
        ...(s.baseline !== null ? { baseline: s.baseline, baselineDisplay: fmtStat(s.key, s.baseline) } : {}),
        decimals: STAT_DECIMALS[s.key],
        higherIsBetter: s.higherIsBetter,
        ...(partial ? { note: "SO FAR" } : {}),
        showDelta: hasValue && !partial,
      };
    });
}

/** 24 hourly capsules from stored rows (missing min/max fall back to the average). */
export function hourPoints(rows: readonly HourRow[]): HourPoint[] {
  const out: HourPoint[] = Array.from({ length: 24 }, () => null);
  for (const r of rows) {
    if (r.hour < 0 || r.hour > 23) continue;
    const min = r.min ?? r.avg;
    const max = r.max ?? r.avg;
    out[r.hour] = { hour: r.hour, min: Math.min(min, r.avg), max: Math.max(max, r.avg), avg: r.avg };
  }
  return out;
}

const STAGED: ReadonlySet<string> = new Set(["awake", "rem", "core", "deep"]);

export function sleepCardView(o: Overview, ctx: Pick<Ctx, "tz" | "h12">, isToday: boolean): SleepCardView {
  const s = o.sleep;
  if (!s) {
    return { kind: "none", message: isToday ? "Last night hasn't synced yet." : "No sleep was recorded this night." };
  }
  const n = s.night;
  const bed = formatClock(n.bedStart.getTime(), ctx.tz, ctx.h12);
  const wake = formatClock(n.bedEnd.getTime(), ctx.tz, ctx.h12);
  const device = deviceName(n.chosenSource);
  const own = s.segments.filter((g) => g.source === n.chosenSource && g.stage !== "in_bed");
  const ms = (g: OverviewSegment) => ({ start: g.start.getTime(), end: g.end.getTime() });

  if (!n.asleepMin || n.asleepMin <= 0) {
    return { kind: "in_bed", inBed: formatDuration(n.inBedMin ?? 0), bed, wake, source: n.chosenSource, device };
  }
  if (n.hasStages && own.some((g) => STAGED.has(g.stage) && g.stage !== "awake")) {
    const eff = o.scores?.components?.sleep.efficiency ?? null;
    return {
      kind: "stages",
      segments: own.filter((g) => STAGED.has(g.stage)).map((g) => ({ stage: g.stage as SleepStage, ...ms(g) })),
      asleep: formatHm(n.asleepMin),
      inBed: n.inBedMin ? formatHm(n.inBedMin) : null,
      efficiency: eff,
      bed,
      wake,
      source: n.chosenSource,
    };
  }
  return {
    kind: "timeline",
    blocks: own.map((g) => ({ asleep: g.stage !== "awake", ...ms(g) })),
    asleep: formatHm(n.asleepMin),
    bed,
    wake,
    source: n.chosenSource,
    device,
  };
}

export function buildOverviewView(o: Overview, ctx: Ctx): OverviewView {
  const isToday = o.date === ctx.today;
  const comp = o.scores?.components ?? null;
  const rec = comp?.recovery ?? null;
  const band = rec?.band ?? null;
  const recValue = o.scores?.recovery ?? null;
  const glow = recValue !== null ? recoveryColor(recValue) : NEUTRAL_SIGNAL;
  const nav = dayNav(o.date, ctx.today, ctx.firstDate);

  const hours = hourPoints(o.hrHourly);
  const present = hours.filter((h): h is NonNullable<HourPoint> => h !== null);
  const zones = comp?.strain && comp.strain.components.hoursWithHr > 0 ? Object.values(comp.strain.zones) : null;

  return {
    date: o.date,
    today: ctx.today,
    title: dayTitle(o.date, ctx.today),
    dateLabel: daySubtitle(o.date, ctx.today),
    prev: nav.prev,
    next: nav.next,
    isToday,
    h12: ctx.h12,
    glow,
    band,
    recovery: {
      value: recValue,
      reason: recoveryNullReason(rec, { isToday, facts: ctx.facts, sleep: comp?.sleep ?? null }),
      limited: recValue !== null && !!rec?.limited,
      live: false,
      color: glow,
    },
    strain: {
      value: o.scores?.strain ?? null,
      reason: strainNullReason(comp?.strain ?? null, { isToday }),
      limited: false,
      live: isToday && o.scores?.strain != null,
      color: SIGNAL.strain,
    },
    sleep: {
      value: o.scores?.sleep ?? null,
      reason: sleepNullReason(comp?.sleep ?? null, { isToday }),
      limited: false,
      live: false,
      color: SIGNAL.sleep,
    },
    stats: statViews(o.stats, { isToday, facts: ctx.facts }),
    strainCard: {
      strain: o.scores?.strain ?? null,
      hours,
      nowHour: currentHourFor(o.date, ctx.today, ctx.tz, ctx.now),
      avgHr: present.length ? Math.round(present.reduce((a, h) => a + h.avg, 0) / present.length) : null,
      maxHr: present.length ? Math.max(...present.map((h) => h.max)) : null,
      zones,
      activeKcal: o.activity.activeKcal,
      exerciseMin: o.activity.exerciseMin !== null ? Math.round(o.activity.exerciseMin) : null,
      steps: o.activity.steps,
    },
    sleepCard: sleepCardView(o, ctx, isToday),
    lastSyncAt: o.lastSyncAt ? o.lastSyncAt.toISOString() : null,
    renderedAt: ctx.now.getTime(),
  };
}
