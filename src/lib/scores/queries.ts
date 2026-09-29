/**
 * Read helpers for the score UI (Home overview, detail trends) and the group
 * leaderboards. Plain functions over a Drizzle handle, a few grouped queries
 * each (run in parallel), no per-user loops.
 */

import { and, asc, between, count, desc, eq, inArray, isNull, max, min } from "drizzle-orm";
import {
  dailyMetrics,
  dailyScores,
  groupMembers,
  hrHourly,
  ingestEvents,
  sleepNights,
  sleepSegments,
  users,
  type AvatarConfig,
  type AvatarKind,
} from "@/db/schema";
import type { Executor } from "@/lib/admin/db";
import { isMetricName, type MetricName } from "@/lib/health/fields";
import type { SleepStage } from "@/lib/ingest/types";
import { addDays, todayIn } from "@/lib/tz";
import { priorDates, robustBaseline } from "@/lib/scores/baseline";
import type { ScoreComponents } from "@/lib/scores/compute";
import { isNum, round } from "@/lib/scores/math";
import { BASELINE_DAYS, type HourRow } from "@/lib/scores/types";
import { boardRange, weekStart, type BoardPeriod } from "@/lib/scores/period";

/* ------------------------------------------------------------------------ */
/* Overview                                                                  */
/* ------------------------------------------------------------------------ */

export type ScoreDay = {
  date: string;
  sleep: number | null;
  recovery: number | null;
  strain: number | null;
  components: ScoreComponents | null;
  computedAt: Date;
};

export type KeyStatKey = "resting_hr" | "hrv_sdnn_ms" | "resp_rate" | "sleep_duration" | "steps" | "active_kcal";

export type KeyStat = {
  key: KeyStatKey;
  unit: string;
  value: number | null;
  /** Robust mean over the 30 days before the date (null with < 4 values). */
  baseline: number | null;
  /** Days in the baseline. */
  n: number;
  /** value - baseline. */
  delta: number | null;
  higherIsBetter: boolean;
};

export type OverviewNight = {
  wakeDate: string;
  chosenSource: string;
  bedStart: Date;
  bedEnd: Date;
  inBedMin: number | null;
  asleepMin: number | null;
  awakeMin: number | null;
  coreMin: number | null;
  deepMin: number | null;
  remMin: number | null;
  hasStages: boolean;
};

export type OverviewSegment = { stage: SleepStage; start: Date; end: Date; source: string };

export type Overview = {
  date: string;
  scores: ScoreDay | null;
  previous: ScoreDay | null;
  stats: KeyStat[];
  /** The date's hourly HR (sorted by hour). */
  hrHourly: HourRow[];
  /** The night that ended on `date` and the chosen source's segments (plus in-bed from any source). */
  sleep: { night: OverviewNight; segments: OverviewSegment[] } | null;
  /** The date's activity totals (partial for today). */
  activity: { steps: number | null; activeKcal: number | null; exerciseMin: number | null };
  lastSyncAt: Date | null;
};

const STAT_META: Record<KeyStatKey, { unit: string; higherIsBetter: boolean }> = {
  resting_hr: { unit: "bpm", higherIsBetter: false },
  hrv_sdnn_ms: { unit: "ms", higherIsBetter: true },
  resp_rate: { unit: "breaths/min", higherIsBetter: false },
  sleep_duration: { unit: "min", higherIsBetter: true },
  steps: { unit: "count", higherIsBetter: true },
  active_kcal: { unit: "kcal", higherIsBetter: true },
};

const scoreDayOf = (r: typeof dailyScores.$inferSelect): ScoreDay => ({
  date: r.localDate,
  sleep: r.sleepScore,
  recovery: r.recovery,
  strain: r.strain,
  components: (r.components as ScoreComponents | null) ?? null,
  computedAt: r.computedAt,
});

function keyStat(key: KeyStatKey, value: number | null, history: (number | null)[]): KeyStat {
  const b = robustBaseline(history);
  const v = isNum(value) ? value : null;
  return {
    key,
    ...STAT_META[key],
    value: v,
    baseline: b ? round(b.mean, 2) : null,
    n: b?.n ?? history.filter(isNum).length,
    delta: v !== null && b ? round(v - b.mean, 2) : null,
  };
}

export async function getOverview(db: Executor, userId: string, date: string): Promise<Overview> {
  const start = addDays(date, -BASELINE_DAYS);
  const [scoreRows, metricRows, nightRows, hrRows, segRows, [sync]] = await Promise.all([
    db
      .select()
      .from(dailyScores)
      .where(and(eq(dailyScores.userId, userId), inArray(dailyScores.localDate, [date, addDays(date, -1)]))),
    db
      .select({
        date: dailyMetrics.localDate,
        resting_hr: dailyMetrics.resting_hr,
        hrv_sdnn_ms: dailyMetrics.hrv_sdnn_ms,
        resp_rate: dailyMetrics.resp_rate,
        steps: dailyMetrics.steps,
        active_kcal: dailyMetrics.active_kcal,
        exercise_min: dailyMetrics.exercise_min,
      })
      .from(dailyMetrics)
      .where(and(eq(dailyMetrics.userId, userId), between(dailyMetrics.localDate, start, date))),
    db
      .select()
      .from(sleepNights)
      .where(and(eq(sleepNights.userId, userId), between(sleepNights.wakeDate, start, date))),
    db
      .select({ hour: hrHourly.hour, min: hrHourly.min, avg: hrHourly.avg, max: hrHourly.max })
      .from(hrHourly)
      .where(and(eq(hrHourly.userId, userId), eq(hrHourly.localDate, date)))
      .orderBy(asc(hrHourly.hour)),
    db
      .select({ stage: sleepSegments.stage, start: sleepSegments.startTs, end: sleepSegments.endTs, source: sleepSegments.source })
      .from(sleepSegments)
      .where(and(eq(sleepSegments.userId, userId), eq(sleepSegments.wakeDate, date)))
      .orderBy(asc(sleepSegments.startTs), asc(sleepSegments.id)),
    db
      .select({ at: max(ingestEvents.receivedAt) })
      .from(ingestEvents)
      .where(and(eq(ingestEvents.userId, userId), eq(ingestEvents.status, 200))),
  ]);

  const metrics = new Map(metricRows.map((r) => [r.date, r]));
  const nights = new Map(nightRows.map((n) => [n.wakeDate, n]));
  const window = priorDates(date);
  const asleep = (d: string) => {
    const a = nights.get(d)?.asleepMin;
    return isNum(a) && a > 0 ? a : null;
  };
  const metricStat = (key: "resting_hr" | "hrv_sdnn_ms" | "resp_rate" | "steps" | "active_kcal") =>
    keyStat(
      key,
      metrics.get(date)?.[key] ?? null,
      window.map((d) => metrics.get(d)?.[key] ?? null),
    );
  const stats: KeyStat[] = [
    metricStat("resting_hr"),
    metricStat("hrv_sdnn_ms"),
    metricStat("resp_rate"),
    keyStat("sleep_duration", asleep(date), window.map(asleep)),
    metricStat("steps"),
    metricStat("active_kcal"),
  ];

  const scoreByDate = new Map(scoreRows.map((r) => [r.localDate, scoreDayOf(r)]));
  const n = nights.get(date);
  let sleep: Overview["sleep"] = null;
  if (n) {
    sleep = {
      night: {
        wakeDate: n.wakeDate,
        chosenSource: n.chosenSource,
        bedStart: n.bedStart,
        bedEnd: n.bedEnd,
        inBedMin: n.inBedMin,
        asleepMin: n.asleepMin,
        awakeMin: n.awakeMin,
        coreMin: n.coreMin,
        deepMin: n.deepMin,
        remMin: n.remMin,
        hasStages: n.hasStages,
      },
      segments: segRows.filter((s) => s.source === n.chosenSource || s.stage === "in_bed"),
    };
  }

  return {
    date,
    scores: scoreByDate.get(date) ?? null,
    previous: scoreByDate.get(addDays(date, -1)) ?? null,
    stats,
    hrHourly: hrRows,
    sleep,
    activity: {
      steps: metrics.get(date)?.steps ?? null,
      activeKcal: metrics.get(date)?.active_kcal ?? null,
      exerciseMin: metrics.get(date)?.exercise_min ?? null,
    },
    lastSyncAt: sync?.at ?? null,
  };
}

/* ------------------------------------------------------------------------ */
/* Data span (Home date bounds, first-run check, which vitals a device sends) */
/* ------------------------------------------------------------------------ */

export type DataSpan = {
  /** Earliest / latest local date with any stored input (metrics, hourly HR or a night); null = none. */
  firstDate: string | null;
  lastDate: string | null;
  /** Whether the user has EVER sent these (a device that never writes HRV shouldn't get an HRV row). */
  hasHrv: boolean;
  hasResp: boolean;
  hasRhr: boolean;
  /** Most recent successful sync; null = never. */
  lastSyncAt: Date | null;
};

/** Four small aggregate queries, run in parallel. */
export async function getDataSpan(db: Executor, userId: string): Promise<DataSpan> {
  const [[m], [n], [h], [sync]] = await Promise.all([
    db
      .select({
        first: min(dailyMetrics.localDate),
        last: max(dailyMetrics.localDate),
        hrv: count(dailyMetrics.hrv_sdnn_ms),
        resp: count(dailyMetrics.resp_rate),
        rhr: count(dailyMetrics.resting_hr),
      })
      .from(dailyMetrics)
      .where(eq(dailyMetrics.userId, userId)),
    db
      .select({ first: min(sleepNights.wakeDate), last: max(sleepNights.wakeDate) })
      .from(sleepNights)
      .where(eq(sleepNights.userId, userId)),
    db
      .select({ first: min(hrHourly.localDate), last: max(hrHourly.localDate) })
      .from(hrHourly)
      .where(eq(hrHourly.userId, userId)),
    db
      .select({ at: max(ingestEvents.receivedAt) })
      .from(ingestEvents)
      .where(and(eq(ingestEvents.userId, userId), eq(ingestEvents.status, 200))),
  ]);
  const firsts = [m?.first, n?.first, h?.first].filter((d): d is string => !!d).sort();
  const lasts = [m?.last, n?.last, h?.last].filter((d): d is string => !!d).sort();
  return {
    firstDate: firsts[0] ?? null,
    lastDate: lasts.at(-1) ?? null,
    hasHrv: (m?.hrv ?? 0) > 0,
    hasResp: (m?.resp ?? 0) > 0,
    hasRhr: (m?.rhr ?? 0) > 0,
    lastSyncAt: sync?.at ?? null,
  };
}

export type NightWindow = { wakeDate: string; bedStart: Date; bedEnd: Date; asleepMin: number | null };

/** Nights that ended on `endDate` and the `nights - 1` dates before it, oldest first (missing nights are absent). */
export async function getRecentNights(db: Executor, userId: string, endDate: string, nights = 7): Promise<NightWindow[]> {
  return db
    .select({
      wakeDate: sleepNights.wakeDate,
      bedStart: sleepNights.bedStart,
      bedEnd: sleepNights.bedEnd,
      asleepMin: sleepNights.asleepMin,
    })
    .from(sleepNights)
    .where(
      and(eq(sleepNights.userId, userId), between(sleepNights.wakeDate, addDays(endDate, -(nights - 1)), endDate)),
    )
    .orderBy(asc(sleepNights.wakeDate));
}

/* ------------------------------------------------------------------------ */
/* Trends                                                                    */
/* ------------------------------------------------------------------------ */

export type TrendRange = "1w" | "1m" | "6m";
export const TREND_DAYS: Record<TrendRange, number> = { "1w": 7, "1m": 30, "6m": 182 };
export type ScoreMetric = "recovery" | "strain" | "sleep";
export type TrendMetric = ScoreMetric | "sleep_duration" | MetricName;
export type TrendPoint = { date: string; value: number | null };

const SCORE_COLUMN = { recovery: dailyScores.recovery, strain: dailyScores.strain, sleep: dailyScores.sleepScore } as const;
const isScoreMetric = (m: string): m is ScoreMetric => m in SCORE_COLUMN;

/**
 * Daily points for the `range` ending at `endDate` (default: today in the
 * user's timezone), oldest first, one per date (null = no value).
 */
export async function getTrend(
  db: Executor,
  userId: string,
  metric: TrendMetric,
  range: TrendRange,
  endDate?: string,
): Promise<TrendPoint[]> {
  let end = endDate;
  if (!end) {
    const [u] = await db.select({ tz: users.timezone }).from(users).where(eq(users.id, userId)).limit(1);
    end = todayIn(u?.tz || "UTC");
  }
  const start = addDays(end, -(TREND_DAYS[range] - 1));

  let rows: { date: string; value: number | null }[];
  if (isScoreMetric(metric)) {
    rows = await db
      .select({ date: dailyScores.localDate, value: SCORE_COLUMN[metric] })
      .from(dailyScores)
      .where(and(eq(dailyScores.userId, userId), between(dailyScores.localDate, start, end)));
  } else if (metric === "sleep_duration") {
    rows = (
      await db
        .select({ date: sleepNights.wakeDate, value: sleepNights.asleepMin })
        .from(sleepNights)
        .where(and(eq(sleepNights.userId, userId), between(sleepNights.wakeDate, start, end)))
    ).map((r) => ({ date: r.date, value: isNum(r.value) && r.value > 0 ? r.value : null }));
  } else if (isMetricName(metric)) {
    const column = dailyMetrics[metric];
    rows = await db
      .select({ date: dailyMetrics.localDate, value: column })
      .from(dailyMetrics)
      .where(and(eq(dailyMetrics.userId, userId), between(dailyMetrics.localDate, start, end)));
  } else {
    throw new Error(`getTrend: unknown metric ${String(metric)}`);
  }

  const byDate = new Map(rows.map((r) => [r.date, r.value]));
  const out: TrendPoint[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push({ date: d, value: byDate.get(d) ?? null });
  return out;
}

/* ------------------------------------------------------------------------ */
/* Group leaderboards                                                        */
/* ------------------------------------------------------------------------ */

export type { BoardPeriod };
export { boardRange, weekStart };

/** A weekly entry needs at least this many days with a value. */
export const WEEK_MIN_DAYS = 4;

export type BoardMember = {
  userId: string;
  username: string | null;
  displayName: string | null;
  avatarKind: AvatarKind | null;
  avatarConfig: AvatarConfig | null;
  avatarPath: string | null;
};

export type BoardRow = BoardMember & {
  rank: number;
  /** The day's score, or the weekly mean (1 decimal). */
  value: number;
  /** Days that went into the value. */
  days: number;
};

/** A member with some data in the week, but fewer than WEEK_MIN_DAYS days (not ranked). */
export type BoardShortfall = BoardMember & { days: number };

export type GroupBoard = {
  metric: ScoreMetric;
  period: BoardPeriod;
  from: string;
  to: string;
  rows: BoardRow[];
  /** Week only: members with 1-3 days of this score, most days first (always empty for a day). */
  insufficient: BoardShortfall[];
};

export const SCORE_METRICS: readonly ScoreMetric[] = ["strain", "recovery", "sleep"];

const nameKey = (m: BoardMember) => m.displayName ?? m.username ?? "";

/**
 * Ranked members of a group for every score on a day, or averaged over the
 * Monday-Sunday week containing `date` (each member's own local dates; at
 * least 4 days). Members without data (or deactivated) are left out; in a
 * week, members with 1-3 days come back in `insufficient`. Ties share a rank
 * (1, 1, 3), compared at display precision. Two queries for all three boards.
 */
export async function getGroupBoards(
  db: Executor,
  groupId: string,
  period: BoardPeriod,
  date: string,
): Promise<Record<ScoreMetric, GroupBoard>> {
  const { from, to } = boardRange(period, date);
  const empty = (metric: ScoreMetric): GroupBoard => ({ metric, period, from, to, rows: [], insufficient: [] });
  const members = await db
    .select({
      userId: users.id,
      username: users.username,
      displayName: users.displayName,
      avatarKind: users.avatarKind,
      avatarConfig: users.avatarConfig,
      avatarPath: users.avatarPath,
    })
    .from(groupMembers)
    .innerJoin(users, eq(users.id, groupMembers.userId))
    .where(and(eq(groupMembers.groupId, groupId), isNull(users.deactivatedAt)));
  if (members.length === 0) return { strain: empty("strain"), recovery: empty("recovery"), sleep: empty("sleep") };

  const scores = await db
    .select({
      userId: dailyScores.userId,
      strain: dailyScores.strain,
      recovery: dailyScores.recovery,
      sleep: dailyScores.sleepScore,
    })
    .from(dailyScores)
    .where(
      and(
        inArray(dailyScores.userId, members.map((m) => m.userId)),
        between(dailyScores.localDate, from, to),
      ),
    );

  const build = (metric: ScoreMetric): GroupBoard => {
    const values = new Map<string, number[]>();
    for (const s of scores) {
      const v = s[metric];
      if (!isNum(v)) continue;
      const list = values.get(s.userId);
      if (list) list.push(v);
      else values.set(s.userId, [v]);
    }

    const decimals = period === "week" || metric === "strain" ? 1 : 0;
    const minDays = period === "week" ? WEEK_MIN_DAYS : 1;
    const unranked: Omit<BoardRow, "rank">[] = [];
    const insufficient: BoardShortfall[] = [];
    for (const m of members) {
      const vs = values.get(m.userId) ?? [];
      if (vs.length === 0) continue;
      if (vs.length < minDays) insufficient.push({ ...m, days: vs.length });
      else unranked.push({ ...m, value: round(vs.reduce((a, b) => a + b, 0) / vs.length, decimals), days: vs.length });
    }
    const byName = (a: BoardMember, b: BoardMember) => nameKey(a).localeCompare(nameKey(b)) || a.userId.localeCompare(b.userId);
    unranked.sort((a, b) => b.value - a.value || byName(a, b));
    insufficient.sort((a, b) => b.days - a.days || byName(a, b));
    const rows: BoardRow[] = [];
    unranked.forEach((r, i) => {
      const rank = i > 0 && r.value === unranked[i - 1].value ? rows[i - 1].rank : i + 1;
      rows.push({ rank, ...r });
    });
    return { metric, period, from, to, rows, insufficient };
  };

  return { strain: build("strain"), recovery: build("recovery"), sleep: build("sleep") };
}

/** One score's board (see `getGroupBoards`). */
export async function getGroupBoard(
  db: Executor,
  groupId: string,
  metric: ScoreMetric,
  period: BoardPeriod,
  date: string,
): Promise<GroupBoard> {
  return (await getGroupBoards(db, groupId, period, date))[metric];
}

/** Latest date with a stored score for the user (for "today" fallbacks); null when none. */
export async function latestScoreDate(db: Executor, userId: string): Promise<string | null> {
  const [r] = await db
    .select({ date: dailyScores.localDate })
    .from(dailyScores)
    .where(eq(dailyScores.userId, userId))
    .orderBy(desc(dailyScores.localDate))
    .limit(1);
  return r?.date ?? null;
}
