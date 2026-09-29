/**
 * Community tab data: which groups a user is in, each member's scores for the
 * group's "today", the group's today averages, and the group's daily
 * recovery trend. Plain functions over a Drizzle handle; a fixed number of
 * grouped queries however many groups or members (no per-member loops).
 *
 * Timezones: a group's "today" is the current date in `groups.timezone` (the
 * group date). For a group date D every member's row is their own data for
 * local_date = D: the same calendar-day label, whatever time it is where they
 * live (a friend in Kolkata who is already on tomorrow still counts for D).
 * Trend dates and the leaderboards use the same convention.
 */

import { and, asc, between, eq, inArray, isNull, min, sql } from "drizzle-orm";
import { dailyMetrics, dailyScores, groupMembers, groups, users, type AvatarConfig, type AvatarKind } from "@/db/schema";
import type { Executor } from "@/lib/admin/db";
import { getSyncSummaries } from "@/lib/sync-status";
import { addDays, todayIn } from "@/lib/tz";
import { groupToday, type GroupToday, type TodayScores } from "./view";

export type GroupRef = { id: string; name: string; timezone: string };

export type GroupMember = {
  userId: string;
  username: string | null;
  displayName: string | null;
  avatarKind: AvatarKind | null;
  avatarConfig: AvatarConfig | null;
  avatarPath: string | null;
  timezone: string;
  /** The group date this row is for (the member's own local_date = this). */
  date: string;
  /** Scores on the member's local_date = group date (nulls when there's no row / no score yet). */
  scores: TodayScores;
  /** Most recent successful sync; null = never. */
  lastSyncAt: Date | null;
  /** Has a daily_metrics or daily_scores row for the group date. */
  hasData: boolean;
};

export type GroupWithToday = GroupRef & {
  /** The group's today: the current date in the group's timezone. */
  date: string;
  members: GroupMember[];
  today: GroupToday;
};

/** The group's "today": the current date in its timezone (UTC if blank). */
export function groupDateOf(group: Pick<GroupRef, "timezone">, now: Date = new Date()): string {
  return todayIn(group.timezone || "UTC", now);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Syntactically a UUID (so a junk `/groups/abc` 404s without a Postgres cast error). */
export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/**
 * The group, if `userId` is a member; otherwise null (callers 404). Admins
 * get no exemption: membership is the only way in.
 */
export async function getMemberGroup(db: Executor, groupId: string, userId: string): Promise<GroupRef | null> {
  if (!isUuid(groupId)) return null;
  const [row] = await db
    .select({ id: groups.id, name: groups.name, timezone: groups.timezone })
    .from(groups)
    .innerJoin(groupMembers, and(eq(groupMembers.groupId, groups.id), eq(groupMembers.userId, userId)))
    .where(eq(groups.id, groupId))
    .limit(1);
  return row ?? null;
}

/**
 * Active members of each group with their scores and data flag for the
 * group's date (today in the group's timezone; see the file header): one
 * members query, one scores query and one daily-metrics query (all members
 * and dates at once) plus the two grouped sync-summary queries. Members are
 * ordered by join time, then name.
 */
export async function getMembersToday(
  db: Executor,
  groupList: readonly GroupRef[],
  now: Date = new Date(),
): Promise<Map<string, GroupMember[]>> {
  const out = new Map<string, GroupMember[]>(groupList.map((g) => [g.id, []]));
  if (groupList.length === 0) return out;
  const dateOf = new Map(groupList.map((g) => [g.id, groupDateOf(g, now)]));

  const rows = await db
    .select({
      groupId: groupMembers.groupId,
      userId: users.id,
      username: users.username,
      displayName: users.displayName,
      avatarKind: users.avatarKind,
      avatarConfig: users.avatarConfig,
      avatarPath: users.avatarPath,
      timezone: users.timezone,
    })
    .from(groupMembers)
    .innerJoin(users, eq(users.id, groupMembers.userId))
    .where(and(inArray(groupMembers.groupId, [...dateOf.keys()]), isNull(users.deactivatedAt)))
    .orderBy(asc(groupMembers.joinedAt), asc(users.displayName), asc(users.id));
  if (rows.length === 0) return out;

  const ids = [...new Set(rows.map((r) => r.userId))];
  const dates = [...new Set(dateOf.values())];
  const key = (userId: string, date: string) => `${userId}|${date}`;

  const [scoreRows, metricRows, syncs] = await Promise.all([
    db
      .select({
        userId: dailyScores.userId,
        date: dailyScores.localDate,
        recovery: dailyScores.recovery,
        strain: dailyScores.strain,
        sleep: dailyScores.sleepScore,
      })
      .from(dailyScores)
      .where(and(inArray(dailyScores.userId, ids), inArray(dailyScores.localDate, dates))),
    db
      .select({ userId: dailyMetrics.userId, date: dailyMetrics.localDate })
      .from(dailyMetrics)
      .where(and(inArray(dailyMetrics.userId, ids), inArray(dailyMetrics.localDate, dates))),
    getSyncSummaries(db, ids),
  ]);

  const scores = new Map<string, TodayScores>();
  const withData = new Set<string>();
  for (const s of scoreRows) {
    scores.set(key(s.userId, s.date), { recovery: s.recovery, strain: s.strain, sleep: s.sleep });
    withData.add(key(s.userId, s.date));
  }
  for (const m of metricRows) withData.add(key(m.userId, m.date));

  for (const r of rows) {
    const date = dateOf.get(r.groupId)!;
    out.get(r.groupId)!.push({
      userId: r.userId,
      username: r.username,
      displayName: r.displayName,
      avatarKind: r.avatarKind,
      avatarConfig: r.avatarConfig,
      avatarPath: r.avatarPath,
      timezone: r.timezone || "UTC",
      date,
      scores: scores.get(key(r.userId, date)) ?? { recovery: null, strain: null, sleep: null },
      lastSyncAt: syncs.get(r.userId)?.lastSyncAt ?? null,
      hasData: withData.has(key(r.userId, date)),
    });
  }
  return out;
}

/** Groups the user belongs to (oldest membership first), each with members and the group's today averages. */
export async function listMemberGroups(db: Executor, userId: string, now: Date = new Date()): Promise<GroupWithToday[]> {
  const mine = await db
    .select({ id: groups.id, name: groups.name, timezone: groups.timezone })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(eq(groupMembers.userId, userId))
    .orderBy(asc(groupMembers.joinedAt), asc(groups.name));
  if (mine.length === 0) return [];
  const members = await getMembersToday(db, mine, now);
  return mine.map((g) => {
    const list = members.get(g.id) ?? [];
    return { ...g, date: groupDateOf(g, now), members: list, today: groupToday(list) };
  });
}

export type GroupTrendPoint = { date: string; value: number | null; n: number };

/** Active members of a group (subquery for the aggregate helpers below). */
const activeMemberIds = (db: Executor, groupId: string) =>
  db
    .select({ id: groupMembers.userId })
    .from(groupMembers)
    .innerJoin(users, eq(users.id, groupMembers.userId))
    .where(and(eq(groupMembers.groupId, groupId), isNull(users.deactivatedAt)));

/**
 * Daily mean recovery across the group's active members for the `days` local
 * dates ending at `endDate`, oldest first (null = nobody had a score). One
 * aggregate query.
 */
export async function getGroupRecoveryTrend(
  db: Executor,
  groupId: string,
  endDate: string,
  days = 7,
): Promise<GroupTrendPoint[]> {
  const start = addDays(endDate, -(days - 1));
  const rows = await db
    .select({
      date: dailyScores.localDate,
      value: sql<number | null>`avg(${dailyScores.recovery})::float8`,
      n: sql<number>`count(${dailyScores.recovery})::int`,
    })
    .from(dailyScores)
    .where(
      and(inArray(dailyScores.userId, activeMemberIds(db, groupId)), between(dailyScores.localDate, start, endDate)),
    )
    .groupBy(dailyScores.localDate);
  const byDate = new Map(rows.map((r) => [r.date, r]));
  const out: GroupTrendPoint[] = [];
  for (let d = start; d <= endDate; d = addDays(d, 1)) {
    const r = byDate.get(d);
    const value = r && r.n > 0 && r.value !== null ? Math.round(r.value * 10) / 10 : null;
    out.push({ date: d, value, n: value === null ? 0 : r!.n });
  }
  return out;
}

/** Earliest local date with a stored score among the group's active members (bounds the board date picker); null = none. */
export async function getGroupFirstScoreDate(db: Executor, groupId: string): Promise<string | null> {
  const [r] = await db
    .select({ first: min(dailyScores.localDate) })
    .from(dailyScores)
    .where(inArray(dailyScores.userId, activeMemberIds(db, groupId)));
  return r?.first ?? null;
}
