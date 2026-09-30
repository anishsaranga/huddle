/**
 * Weekly champions: who won what in a group's completed week.
 *
 * Week: Monday-Sunday in the group's timezone (the group-local Monday is
 * `week_start`). Like the weekly leaderboards, each member contributes their
 * own `local_date`s in that date range (same calendar-day labels wherever
 * they live) and needs at least WEEK_MIN_DAYS (4) days with a value to be
 * ranked in a category. Deactivated members are left out.
 *
 * Categories:
 * - recovery: best mean recovery;   sleep: best mean sleep score;
 * - strain:   highest mean strain;  steps: highest total steps (days with a
 *   step count; >= 4 of them);
 * - improved: biggest gain in mean recovery over the week before (both weeks
 *   need >= 4 days; only a positive gain counts).
 * Means are compared at display precision (1 decimal, like the week boards);
 * steps are whole numbers.
 *
 * Ties: one winner per category, by a deterministic tiebreak: the higher
 * value, then more days of data, then display name (case-insensitive, en),
 * then user id. The next two are the runners-up.
 *
 * A category nobody qualifies for is left out; no post at all (null) when
 * fewer than 2 members qualify for any category.
 *
 * `computeChampions` is pure; `loadChampionFacts` loads its inputs (3 queries).
 */

import { and, between, eq, inArray, isNull } from "drizzle-orm";
import { dailyMetrics, dailyScores, groupMembers, groups, users, type AvatarConfig, type AvatarKind } from "@/db/schema";
import type { Executor } from "@/lib/admin/db";
import { weekStart as mondayOf } from "@/lib/scores/period";
import { addDays, localParts, todayIn } from "@/lib/tz";
import {
  CATEGORY_META,
  CHAMPION_CATEGORIES,
  weekLabel,
  type ChampionCategory,
  type ChampionCategoryResult,
  type ChampionEntry,
  type ChampionFacts,
} from "./types";

/** A member needs this many days in the week to be ranked (same as the week boards). */
export const CHAMPION_MIN_DAYS = 4;
/** No post when fewer members qualify. */
export const CHAMPION_MIN_MEMBERS = 2;
/** Group-local hour on Monday from which last week's post is due. */
export const CHAMPIONS_POST_HOUR = 9;
/** Places per category in the payload (winner + runners-up). */
const TOP = 3;

/* ------------------------------------------------------------------------ */
/* Week boundaries (group timezone)                                          */
/* ------------------------------------------------------------------------ */

export type ChampionsSchedule = {
  /** Today in the group's timezone. */
  today: string;
  /** Monday of the last completed week (the week a post now would be about). */
  weekStart: string;
  /** Past Monday 09:00 group-local of the current week, i.e. last week's post is due (or overdue). */
  due: boolean;
};

/**
 * Where a group stands at `now`: the last completed Monday-Sunday week in its
 * timezone and whether its post is due. Due from Monday 09:00 local through
 * the following Sunday (so a worker that was down catches up later in the
 * week); a week older than that is never posted automatically.
 */
export function championsSchedule(timezone: string, now: Date): ChampionsSchedule {
  const tz = timezone || "UTC";
  const today = todayIn(tz, now);
  const thisMonday = mondayOf(today);
  const hour = localParts(now.getTime(), tz).hour;
  return { today, weekStart: addDays(thisMonday, -7), due: today !== thisMonday || hour >= CHAMPIONS_POST_HOUR };
}

/** Monday of the last completed week in `timezone` at `now`. */
export function lastCompletedWeek(timezone: string, now: Date): string {
  return championsSchedule(timezone, now).weekStart;
}

/** Is `date` a Monday (a valid `week_start`)? */
export function isMonday(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && mondayOf(date) === date;
}

/* ------------------------------------------------------------------------ */
/* Pure computation                                                          */
/* ------------------------------------------------------------------------ */

export type ChampionMember = {
  userId: string;
  displayName: string | null;
  username: string | null;
  avatarKind: AvatarKind | null;
  avatarConfig: AvatarConfig | null;
  avatarPath: string | null;
};

export type ChampionDay = {
  userId: string;
  /** The member's local date. */
  date: string;
  sleep?: number | null;
  recovery?: number | null;
  strain?: number | null;
  steps?: number | null;
};

export type ChampionsInput = {
  groupId: string;
  groupName: string;
  weekStart: string;
  members: ChampionMember[];
  /** Days from `weekStart - 7` to `weekStart + 6` (the prior week is only used for "improved"). */
  days: ChampionDay[];
};

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const round = (v: number, d: number) => {
  const f = 10 ** d;
  return Math.round(v * f) / f;
};
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

export function displayNameOf(m: Pick<ChampionMember, "displayName" | "username">): string {
  return m.displayName?.trim() || m.username || "Member";
}

type Candidate = { member: ChampionMember; value: number; days: number; from?: number; to?: number };

/** Higher value, then more days, then name, then id. */
function compareCandidates(a: Candidate, b: Candidate): number {
  return (
    b.value - a.value ||
    b.days - a.days ||
    displayNameOf(a.member).localeCompare(displayNameOf(b.member), "en", { sensitivity: "base" }) ||
    (a.member.userId < b.member.userId ? -1 : a.member.userId > b.member.userId ? 1 : 0)
  );
}

function entryOf(category: ChampionCategory, c: Candidate): ChampionEntry {
  const m = c.member;
  return {
    userId: m.userId,
    displayName: displayNameOf(m),
    username: m.username,
    avatarKind: m.avatarKind,
    avatarConfig: m.avatarConfig,
    avatarPath: m.avatarPath,
    value: c.value,
    unit: CATEGORY_META[category].unit,
    days: c.days,
    ...(c.from !== undefined ? { from: c.from } : {}),
    ...(c.to !== undefined ? { to: c.to } : {}),
  };
}

/** Rank candidates for every category (exported for tests). */
export function rankCategory(category: ChampionCategory, candidates: Candidate[]): ChampionCategoryResult | null {
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort(compareCandidates);
  const top = sorted.slice(0, TOP).map((c) => entryOf(category, c));
  return { category, winners: top.slice(0, 1), runnersUp: top.slice(1) };
}

/** The week's champions for a group, or null when fewer than 2 members qualify for anything. */
export function computeChampions(input: ChampionsInput): ChampionFacts | null {
  const { weekStart } = input;
  const weekEnd = addDays(weekStart, 6);
  const priorStart = addDays(weekStart, -7);
  const priorEnd = addDays(weekStart, -1);

  type Series = { sleep: number[]; recovery: number[]; strain: number[]; steps: number[]; priorRecovery: number[] };
  const byUser = new Map<string, Series>();
  const seen = new Set<string>(); // user|date, first row wins (inputs are keyed by date anyway)
  for (const d of input.days) {
    const key = `${d.userId}|${d.date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    let s = byUser.get(d.userId);
    if (!s) byUser.set(d.userId, (s = { sleep: [], recovery: [], strain: [], steps: [], priorRecovery: [] }));
    if (d.date >= weekStart && d.date <= weekEnd) {
      if (isNum(d.sleep)) s.sleep.push(d.sleep);
      if (isNum(d.recovery)) s.recovery.push(d.recovery);
      if (isNum(d.strain)) s.strain.push(d.strain);
      if (isNum(d.steps)) s.steps.push(d.steps);
    } else if (d.date >= priorStart && d.date <= priorEnd) {
      if (isNum(d.recovery)) s.priorRecovery.push(d.recovery);
    }
  }

  const candidates: Record<ChampionCategory, Candidate[]> = { recovery: [], strain: [], sleep: [], steps: [], improved: [] };
  for (const member of input.members) {
    const s = byUser.get(member.userId);
    if (!s) continue;
    for (const k of ["recovery", "strain", "sleep"] as const) {
      if (s[k].length >= CHAMPION_MIN_DAYS) candidates[k].push({ member, value: round(mean(s[k]), 1), days: s[k].length });
    }
    if (s.steps.length >= CHAMPION_MIN_DAYS) {
      candidates.steps.push({ member, value: Math.round(s.steps.reduce((a, b) => a + b, 0)), days: s.steps.length });
    }
    if (s.recovery.length >= CHAMPION_MIN_DAYS && s.priorRecovery.length >= CHAMPION_MIN_DAYS) {
      const from = mean(s.priorRecovery);
      const to = mean(s.recovery);
      const gain = round(to - from, 1);
      if (gain > 0) candidates.improved.push({ member, value: gain, days: s.recovery.length, from: round(from, 1), to: round(to, 1) });
    }
  }

  const eligible = new Set<string>();
  for (const k of ["recovery", "strain", "sleep", "steps"] as const) for (const c of candidates[k]) eligible.add(c.member.userId);
  if (eligible.size < CHAMPION_MIN_MEMBERS) return null;

  const categories = CHAMPION_CATEGORIES.map((k) => rankCategory(k, candidates[k])).filter(
    (c): c is ChampionCategoryResult => c !== null,
  );
  return {
    groupId: input.groupId,
    groupName: input.groupName,
    weekStart,
    weekLabel: weekLabel(weekStart),
    eligible: eligible.size,
    categories,
  };
}

/* ------------------------------------------------------------------------ */
/* Loading                                                                   */
/* ------------------------------------------------------------------------ */

export type ChampionGroup = { id: string; name: string; timezone: string };

export async function getChampionGroup(db: Executor, groupId: string): Promise<ChampionGroup | null> {
  const [g] = await db
    .select({ id: groups.id, name: groups.name, timezone: groups.timezone })
    .from(groups)
    .where(eq(groups.id, groupId))
    .limit(1);
  return g ?? null;
}

/**
 * Load a group's members and their scores/steps for the week and the week
 * before, then compute (members + scores + steps: three queries).
 */
export async function loadChampionFacts(db: Executor, group: ChampionGroup, weekStart: string): Promise<ChampionFacts | null> {
  const members = await db
    .select({
      userId: users.id,
      displayName: users.displayName,
      username: users.username,
      avatarKind: users.avatarKind,
      avatarConfig: users.avatarConfig,
      avatarPath: users.avatarPath,
    })
    .from(groupMembers)
    .innerJoin(users, eq(users.id, groupMembers.userId))
    .where(and(eq(groupMembers.groupId, group.id), isNull(users.deactivatedAt)));
  if (members.length < CHAMPION_MIN_MEMBERS) return null;
  const ids = members.map((m) => m.userId);
  const from = addDays(weekStart, -7);
  const to = addDays(weekStart, 6);

  const [scores, steps] = await Promise.all([
    db
      .select({
        userId: dailyScores.userId,
        date: dailyScores.localDate,
        sleep: dailyScores.sleepScore,
        recovery: dailyScores.recovery,
        strain: dailyScores.strain,
      })
      .from(dailyScores)
      .where(and(inArray(dailyScores.userId, ids), between(dailyScores.localDate, from, to))),
    db
      .select({ userId: dailyMetrics.userId, date: dailyMetrics.localDate, steps: dailyMetrics.steps })
      .from(dailyMetrics)
      .where(and(inArray(dailyMetrics.userId, ids), between(dailyMetrics.localDate, weekStart, to))),
  ]);

  const days = new Map<string, ChampionDay>();
  for (const s of scores) days.set(`${s.userId}|${s.date}`, { ...s });
  for (const s of steps) {
    const key = `${s.userId}|${s.date}`;
    const d = days.get(key);
    if (d) d.steps = s.steps;
    else days.set(key, { userId: s.userId, date: s.date, steps: s.steps });
  }

  return computeChampions({ groupId: group.id, groupName: group.name, weekStart, members, days: [...days.values()] });
}
