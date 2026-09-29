/**
 * Sleep merging (pure). Raw Health sleep-analysis segments from any number of
 * sources (Apple Watch, iPhone, Zepp, Fitbit, ...) become sessions, sessions
 * become nights keyed by wake date, and each night gets one summary computed
 * from the best source. All durations are real elapsed time (epoch ms), so
 * DST changes don't distort them; only dates/hours use the user's timezone.
 */

import { dict } from "@/lib/ingest/dict";
import type { SleepStage } from "@/lib/ingest/types";
import { localDateOf, localParts } from "@/lib/tz";

/** A validated segment (instants in epoch ms, `end >= start`). */
export type Segment = { stage: SleepStage; start: number; end: number; source: string };

const MIN = 60_000;
/** A gap this long (or longer) between segments starts a new session. */
export const SESSION_GAP_MS = 90 * MIN;
/** Sessions with less sleep than this, ending between NAP_WINDOW hours, are naps. */
export const NAP_MAX_ASLEEP_MIN = 60;
export const NAP_WINDOW = { fromMin: 10 * 60, toMin: 18 * 60 } as const;

const ASLEEP_STAGES: ReadonlySet<SleepStage> = new Set<SleepStage>(["asleep", "core", "deep", "rem"]);
const DETAIL_STAGES: ReadonlySet<SleepStage> = new Set<SleepStage>(["core", "deep", "rem"]);

/** HKCategoryValueSleepAnalysis raw values, in case a Shortcut sends numbers. */
const HK_CODES: Record<number, SleepStage> = { 0: "in_bed", 1: "asleep", 2: "awake", 3: "core", 4: "deep", 5: "rem" };

const STAGE_NAMES: Record<string, SleepStage> = {
  inbed: "in_bed",
  asleep: "asleep",
  asleepunspecified: "asleep",
  unspecified: "asleep",
  sleep: "asleep",
  sleeping: "asleep",
  awake: "awake",
  core: "core",
  asleepcore: "core",
  light: "core",
  asleeplight: "core",
  deep: "deep",
  asleepdeep: "deep",
  rem: "rem",
  asleeprem: "rem",
};

/**
 * Map a stage as Health / Shortcuts names it to ours. Case, spaces and
 * punctuation are ignored ("In Bed", "inBed", "Asleep (Core)"); "Light" is
 * Fitbit's Core. Returns null for anything unknown.
 */
export function normalizeStage(raw: string | number): SleepStage | null {
  if (typeof raw === "number") return HK_CODES[raw] ?? null;
  const key = raw.toLowerCase().replace(/[^a-z]/g, "");
  return STAGE_NAMES[key] ?? null;
}

type Interval = readonly [number, number];

/** Total minutes covered by the union of the intervals (overlaps count once). */
export function unionMinutes(intervals: readonly Interval[]): number {
  if (intervals.length === 0) return 0;
  const sorted = [...intervals].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let total = 0;
  let [curStart, curEnd] = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    const [s, e] = sorted[i];
    if (s > curEnd) {
      total += curEnd - curStart;
      curStart = s;
      curEnd = e;
    } else if (e > curEnd) {
      curEnd = e;
    }
  }
  total += curEnd - curStart;
  return total / MIN;
}

const intervalsOf = (segs: readonly Segment[], pred: (s: Segment) => boolean): Interval[] =>
  segs.filter(pred).map((s) => [s.start, s.end] as const);

export type Session = { start: number; end: number; segments: Segment[] };

/**
 * Group segments (all sources together) into sessions: sorted by start, a
 * gap of `gapMs` or more after everything so far starts a new session.
 */
export function groupSessions(segments: readonly Segment[], gapMs: number = SESSION_GAP_MS): Session[] {
  const sorted = [...segments].sort((a, b) => a.start - b.start || a.end - b.end);
  const sessions: Session[] = [];
  let cur: Session | null = null;
  for (const seg of sorted) {
    if (cur && seg.start - cur.end < gapMs) {
      cur.segments.push(seg);
      if (seg.end > cur.end) cur.end = seg.end;
    } else {
      cur = { start: seg.start, end: seg.end, segments: [seg] };
      sessions.push(cur);
    }
  }
  return sessions;
}

/** Minutes asleep in a set of segments, across all sources (union). */
export function asleepMinutes(segments: readonly Segment[]): number {
  return unionMinutes(intervalsOf(segments, (s) => ASLEEP_STAGES.has(s.stage)));
}

/** A short daytime session: under an hour asleep, ending 10:00-18:00 local. */
export function isNap(session: Session, tz: string): boolean {
  if (asleepMinutes(session.segments) >= NAP_MAX_ASLEEP_MIN) return false;
  const p = localParts(session.end, tz);
  const minuteOfDay = p.hour * 60 + p.minute;
  return minuteOfDay >= NAP_WINDOW.fromMin && minuteOfDay <= NAP_WINDOW.toMin;
}

export type SourceStats = {
  stages: SleepStage[];
  hasStages: boolean;
  asleepMin: number;
  stageMin: Record<SleepStage, number>;
};

export type NightSummary = {
  wakeDate: string;
  chosenSource: string;
  bedStart: number;
  bedEnd: number;
  inBedMin: number;
  asleepMin: number;
  awakeMin: number;
  coreMin: number;
  deepMin: number;
  remMin: number;
  hasStages: boolean;
  /** Per-source figures (for logs / debugging). */
  sources: Record<string, SourceStats>;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

function sourceStats(segs: readonly Segment[]): SourceStats {
  const stageMin = {} as Record<SleepStage, number>;
  const stages = new Set<SleepStage>();
  for (const stage of ["in_bed", "asleep", "awake", "core", "deep", "rem"] as const) {
    const iv = intervalsOf(segs, (s) => s.stage === stage);
    if (iv.length) stages.add(stage);
    stageMin[stage] = unionMinutes(iv);
  }
  return {
    stages: [...stages],
    hasStages: [...stages].some((s) => DETAIL_STAGES.has(s)),
    asleepMin: asleepMinutes(segs),
    stageMin,
  };
}

/**
 * Pick the night's source: sources with stage detail (core/deep/rem) win;
 * among the candidates the largest asleep total; ties go alphabetically.
 */
export function chooseSource(stats: Record<string, SourceStats>): string {
  const names = Object.keys(stats).sort();
  const detailed = names.filter((n) => stats[n].hasStages);
  const pool = detailed.length ? detailed : names;
  let best = pool[0];
  for (const n of pool) if (stats[n].asleepMin > stats[best].asleepMin) best = n;
  return best;
}

/**
 * Summarize one night (every segment whose session ends on the same local
 * date; several sessions are allowed, e.g. a 3 a.m. wake-up of 2 hours).
 *
 * - Stage minutes come from the chosen source, each stage an interval union.
 * - `inBedMin` is the union of in_bed across ALL sources (the iPhone often
 *   writes only that); without any, the chosen source's span per session.
 * - `awakeMin` is the chosen source's awake union, or in_bed - asleep.
 * - `bedStart`/`bedEnd` span the chosen source, widened by in_bed.
 */
export function summarizeNight(segments: readonly Segment[], tz: string): NightSummary {
  if (segments.length === 0) throw new Error("summarizeNight: no segments");
  const bySource = new Map<string, Segment[]>();
  for (const s of segments) {
    const list = bySource.get(s.source);
    if (list) list.push(s);
    else bySource.set(s.source, [s]);
  }
  const sources = dict<SourceStats>();
  for (const [name, segs] of bySource) sources[name] = sourceStats(segs);
  const chosenSource = chooseSource(sources);
  const chosen = bySource.get(chosenSource)!;
  const cs = sources[chosenSource];

  const inBedIntervals = intervalsOf(segments, (s) => s.stage === "in_bed");
  let inBedMin: number;
  if (inBedIntervals.length) {
    inBedMin = unionMinutes(inBedIntervals);
  } else {
    // No in_bed anywhere: the chosen source's first-to-last span, per session.
    inBedMin = 0;
    for (const session of groupSessions(chosen)) inBedMin += (session.end - session.start) / MIN;
  }

  const asleepMin = cs.asleepMin;
  const awakeMin = cs.stages.includes("awake") ? cs.stageMin.awake : Math.max(0, inBedMin - asleepMin);

  let bedStart = Math.min(...chosen.map((s) => s.start));
  let bedEnd = Math.max(...chosen.map((s) => s.end));
  for (const [s, e] of inBedIntervals) {
    if (s < bedStart) bedStart = s;
    if (e > bedEnd) bedEnd = e;
  }

  const wakeEnd = Math.max(...segments.map((s) => s.end));
  return {
    wakeDate: localDateOf(wakeEnd, tz),
    chosenSource,
    bedStart,
    bedEnd,
    inBedMin: round2(inBedMin),
    asleepMin: round2(asleepMin),
    awakeMin: round2(awakeMin),
    coreMin: round2(cs.stageMin.core),
    deepMin: round2(cs.stageMin.deep),
    remMin: round2(cs.stageMin.rem),
    hasStages: cs.hasStages,
    sources,
  };
}

export type Night = {
  wakeDate: string;
  segments: Segment[];
  /** Time span of each session in the night (used to find superseded older segments). */
  spans: { start: number; end: number }[];
  summary: NightSummary;
};

export type NightsResult = { nights: Night[]; naps: Session[] };

/**
 * Pool segments into sessions, drop naps, and group the rest into nights by
 * wake date (local date of each session's end). Nights sorted by wake date.
 */
export function buildNights(segments: readonly Segment[], tz: string): NightsResult {
  const naps: Session[] = [];
  const byDate = new Map<string, Session[]>();
  for (const session of groupSessions(segments)) {
    if (isNap(session, tz)) {
      naps.push(session);
      continue;
    }
    const wakeDate = localDateOf(session.end, tz);
    const list = byDate.get(wakeDate);
    if (list) list.push(session);
    else byDate.set(wakeDate, [session]);
  }
  const nights = [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([wakeDate, sessions]): Night => {
      const segs = sessions.flatMap((s) => s.segments);
      return {
        wakeDate,
        segments: segs,
        spans: sessions.map((s) => ({ start: s.start, end: s.end })),
        summary: summarizeNight(segs, tz),
      };
    });
  return { nights, naps };
}
