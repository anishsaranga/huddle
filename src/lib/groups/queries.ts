/**
 * Community tab data: which groups a user is in, each member's scores for
 * their own "today", the group's today averages, and the group's daily
 * recovery trend. Plain functions over a Drizzle handle; a fixed number of
 * grouped queries however many groups or members (no per-member loops).
 *
 * Timezones: "today" is per member (`todayIn(member.timezone)`), so a friend
 * in Kolkata is already on tomorrow's date while one in New York isn't.
 * Trend dates, like the leaderboards, are each member's own local dates.
 */

import { and, asc, between, eq, inArray, isNull, min, sql } from "drizzle-orm";
import { dailyScores, groupMembers, groups, users, type AvatarConfig, type AvatarKind } from "@/db/schema";
import type { Executor } from "@/lib/admin/db";
import { getSyncSummaries } from "@/lib/sync-status";
import { addDays, todayIn } from "@/lib/tz";
import { groupToday, isSyncedToday, type GroupToday, type TodayScores } from "./view";

export type GroupRef = { id: string; name: string; timezone: string };

export type GroupMember = {
  userId: string;
  username: string | null;
  displayName: string | null;
  avatarKind: AvatarKind | null;
  avatarConfig: AvatarConfig | null;
  avatarPath: string | null;
  timezone: string;
  /** The member's local date right now. */
  today: string;
  /** Scores on the member's own today (nulls when there's no row / no score yet). */
  scores: TodayScores;
  /** Most recent successful sync; null = never. */
  lastSyncAt: Date | null;
  /** A successful sync on the member's own local today. */
  syncedToday: boolean;
};

export type GroupWithToday = GroupRef & { members: GroupMember[]; today: GroupToday };

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
 * Active members of each group with their today scores and sync state:
 * one members query, one scores query (all members' todays at once) and the
 * two grouped sync-summary queries. Members are ordered by join time, then name.
 */
export async function getMembersToday(
  db: Executor,
  groupIds: string[],
  now: Date = new Date(),
): Promise<Map<string, GroupMember[]>> {
  const out = new Map<string, GroupMember[]>(groupIds.map((id) => [id, []]));
  if (groupIds.length === 0) return out;

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
    .where(and(inArray(groupMembers.groupId, groupIds), isNull(users.deactivatedAt)))
    .orderBy(asc(groupMembers.joinedAt), asc(users.displayName), asc(users.id));
  if (rows.length === 0) return out;

  const people = new Map<string, { tz: string; today: string }>();
  for (const r of rows) {
    if (people.has(r.userId)) continue;
    const tz = r.timezone || "UTC";
    people.set(r.userId, { tz, today: todayIn(tz, now) });
  }
  const ids = [...people.keys()];
  const todays = [...new Set([...people.values()].map((p) => p.today))];

  const [scoreRows, syncs] = await Promise.all([
    db
      .select({
        userId: dailyScores.userId,
        date: dailyScores.localDate,
        recovery: dailyScores.recovery,
        strain: dailyScores.strain,
        sleep: dailyScores.sleepScore,
      })
      .from(dailyScores)
      .where(and(inArray(dailyScores.userId, ids), inArray(dailyScores.localDate, todays))),
    getSyncSummaries(db, ids),
  ]);

  const scores = new Map<string, TodayScores>();
  for (const s of scoreRows) {
    // Only the row for the member's own today (another member's today may be a different date).
    if (people.get(s.userId)?.today !== s.date) continue;
    scores.set(s.userId, { recovery: s.recovery, strain: s.strain, sleep: s.sleep });
  }

  for (const r of rows) {
    const p = people.get(r.userId)!;
    const lastSyncAt = syncs.get(r.userId)?.lastSyncAt ?? null;
    out.get(r.groupId)!.push({
      userId: r.userId,
      username: r.username,
      displayName: r.displayName,
      avatarKind: r.avatarKind,
      avatarConfig: r.avatarConfig,
      avatarPath: r.avatarPath,
      timezone: p.tz,
      today: p.today,
      scores: scores.get(r.userId) ?? { recovery: null, strain: null, sleep: null },
      lastSyncAt,
      syncedToday: isSyncedToday(lastSyncAt, p.tz, now),
    });
  }
  return out;
}

/** Groups the user belongs to (oldest membership first), each with members and today's averages. */
export async function listMemberGroups(db: Executor, userId: string, now: Date = new Date()): Promise<GroupWithToday[]> {
  const mine = await db
    .select({ id: groups.id, name: groups.name, timezone: groups.timezone })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(eq(groupMembers.userId, userId))
    .orderBy(asc(groupMembers.joinedAt), asc(groups.name));
  if (mine.length === 0) return [];
  const members = await getMembersToday(db, mine.map((g) => g.id), now);
  return mine.map((g) => {
    const list = members.get(g.id) ?? [];
    return { ...g, members: list, today: groupToday(list) };
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
