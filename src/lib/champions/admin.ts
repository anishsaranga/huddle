/**
 * Admin view of a group's weekly champions: the last post, whether last
 * week's is out, and a dry run (facts + generated text, nothing written).
 */

import { and, desc, eq } from "drizzle-orm";
import { messages } from "@/db/schema";
import type { Db } from "@/lib/admin/db";
import { championsSchedule, getChampionGroup, loadChampionFacts } from "./compute";
import { createChampionsGenerator, type ChampionsGenerator } from "./generate";
import { findChampionsPost } from "./post";
import { parseChampionsPayload, weekLabel, type ChampionCategoryResult, type ChampionsSource } from "./types";

export type ChampionsAdminStatus = {
  /** The newest champions post in the group (ISO time + its week), if any. */
  lastPost: { at: string; weekStart: string | null; weekLabel: string | null; source: ChampionsSource | null } | null;
  /** The last completed week in the group's timezone (what "Post now" / a dry run use). */
  weekStart: string;
  weekLabel: string;
  /** That week is already posted. */
  posted: boolean;
  /** The worker would post it on its next hourly run (Monday 09:00 group time has passed). */
  due: boolean;
};

export async function getChampionsAdminStatus(db: Db, groupId: string, now: Date = new Date()): Promise<ChampionsAdminStatus | null> {
  const group = await getChampionGroup(db, groupId);
  if (!group) return null;
  const sched = championsSchedule(group.timezone, now);
  const [last] = await db
    .select({ createdAt: messages.createdAt, payload: messages.payload })
    .from(messages)
    .where(and(eq(messages.groupId, groupId), eq(messages.kind, "champions")))
    .orderBy(desc(messages.id))
    .limit(1);
  const lastPayload = last ? parseChampionsPayload(last.payload) : null;
  return {
    lastPost: last
      ? {
          at: last.createdAt.toISOString(),
          weekStart: lastPayload?.weekStart ?? null,
          weekLabel: lastPayload?.weekLabel ?? null,
          source: lastPayload?.source ?? null,
        }
      : null,
    weekStart: sched.weekStart,
    weekLabel: weekLabel(sched.weekStart),
    posted: !!(await findChampionsPost(db, groupId, sched.weekStart)),
    due: sched.due,
  };
}

export type ChampionsDryRun =
  | {
      ok: true;
      weekStart: string;
      weekLabel: string;
      eligible: number;
      categories: ChampionCategoryResult[];
      text: string;
      source: ChampionsSource;
      fallbackReason?: string;
      alreadyPosted: boolean;
    }
  | { ok: false; weekStart: string; weekLabel: string; reason: "not_enough_data" | "no_group" };

/** Compute the last completed week and generate its text, without posting anything. */
export async function dryRunChampions(
  db: Db,
  groupId: string,
  opts: { now?: Date; generate?: ChampionsGenerator } = {},
): Promise<ChampionsDryRun> {
  const now = opts.now ?? new Date();
  const group = await getChampionGroup(db, groupId);
  const weekStart = championsSchedule(group?.timezone ?? "UTC", now).weekStart;
  const label = weekLabel(weekStart);
  if (!group) return { ok: false, weekStart, weekLabel: label, reason: "no_group" };
  const facts = await loadChampionFacts(db, group, weekStart);
  if (!facts || facts.categories.length === 0) return { ok: false, weekStart, weekLabel: label, reason: "not_enough_data" };
  const generated = await (opts.generate ?? createChampionsGenerator())(facts);
  return {
    ok: true,
    weekStart,
    weekLabel: label,
    eligible: facts.eligible,
    categories: facts.categories,
    text: generated.text,
    source: generated.source,
    ...(generated.fallbackReason ? { fallbackReason: generated.fallbackReason } : {}),
    alreadyPosted: !!(await findChampionsPost(db, groupId, weekStart)),
  };
}
