/**
 * Champion flair: who wears a trophy right now.
 *
 * A group's flair is the award set of its most recent champions week, shown
 * until the next post replaces it. It expires on its own two weeks after that
 * week started (a group that stopped qualifying doesn't keep old trophies
 * forever): at `now`, awards count when `week_start` is on or after the
 * Monday two weeks before the group's current week (group timezone), which is
 * last week's post, or the one before it until this Monday's post lands.
 *
 * One query for any number of users.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import { championAwards, groups } from "@/db/schema";
import type { Executor } from "@/lib/admin/db";
import { CHAMPION_CATEGORIES, type ChampionCategory } from "./types";

/** userId → categories held (in CHAMPION_CATEGORIES order), serializable for client components. */
export type FlairMap = Record<string, ChampionCategory[]>;

export async function getActiveFlair(
  db: Executor,
  userIds: readonly string[],
  groupId?: string,
  now: Date = new Date(),
): Promise<FlairMap> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return {};
  const latest = sql`(select max(b.week_start) from ${championAwards} b where b.group_id = ${championAwards.groupId})`;
  const cutoff = sql`((date_trunc('week', ${now.toISOString()}::timestamptz at time zone ${groups.timezone}))::date - 14)`;
  const rows = await db
    .select({ userId: championAwards.userId, category: championAwards.category })
    .from(championAwards)
    .innerJoin(groups, eq(groups.id, championAwards.groupId))
    .where(
      and(
        inArray(championAwards.userId, ids),
        groupId ? eq(championAwards.groupId, groupId) : undefined,
        sql`${championAwards.weekStart} = ${latest}`,
        sql`${championAwards.weekStart} >= ${cutoff}`,
      ),
    );

  const out: FlairMap = {};
  for (const r of rows) (out[r.userId] ??= []).push(r.category);
  for (const list of Object.values(out)) {
    const uniq = [...new Set(list)];
    uniq.sort((a, b) => CHAMPION_CATEGORIES.indexOf(a) - CHAMPION_CATEGORIES.indexOf(b));
    list.splice(0, list.length, ...uniq);
  }
  return out;
}
