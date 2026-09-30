import { asc } from "drizzle-orm";
import { groups } from "@/db/schema";
import { championsSchedule } from "@/lib/champions/compute";
import type { ChampionsGenerator } from "@/lib/champions/generate";
import { findChampionsPost, postWeeklyChampions, type PostResult } from "@/lib/champions/post";
import type { JobContext, JobDef } from "../registry";

export type ChampionsJobDeps = { generate?: ChampionsGenerator };

export type ChampionsRun = { groupId: string; result: PostResult | { status: "not_due"; weekStart: string } | { status: "error"; error: string } };

/**
 * One pass over every group: once the group-local time is past Monday 09:00,
 * last week (Mon-Sun, group timezone) gets its post unless it already has one.
 * Hourly, so a worker that was down catches up on its next run (any day of
 * that week); `postWeeklyChampions` is idempotent, so a second run is a no-op.
 * One group's failure doesn't stop the others.
 */
export async function runChampionsJob(ctx: JobContext, deps: ChampionsJobDeps = {}): Promise<ChampionsRun[]> {
  const now = ctx.now();
  const list = await ctx.db.select({ id: groups.id, timezone: groups.timezone }).from(groups).orderBy(asc(groups.createdAt));
  const runs: ChampionsRun[] = [];
  for (const g of list) {
    const sched = championsSchedule(g.timezone, now);
    if (!sched.due) {
      runs.push({ groupId: g.id, result: { status: "not_due", weekStart: sched.weekStart } });
      continue;
    }
    try {
      if (await findChampionsPost(ctx.db, g.id, sched.weekStart)) {
        runs.push({ groupId: g.id, result: { status: "already_posted", weekStart: sched.weekStart, messageId: null } });
        continue;
      }
      const result = await postWeeklyChampions(ctx.db, g.id, sched.weekStart, { now, generate: deps.generate, log: ctx.log });
      runs.push({ groupId: g.id, result });
    } catch (err) {
      ctx.log.error({ groupId: g.id, weekStart: sched.weekStart, err }, "champions post failed");
      runs.push({ groupId: g.id, result: { status: "error", error: err instanceof Error ? err.message : String(err) } });
    }
  }
  const count = (s: string) => runs.filter((r) => r.result.status === s).length;
  ctx.log.info(
    { groups: runs.length, posted: count("posted"), skipped: count("skipped"), alreadyPosted: count("already_posted"), notDue: count("not_due"), errors: count("error") },
    "champions check done",
  );
  if (count("error") > 0) throw new Error(`champions: ${count("error")} group(s) failed`);
  return runs;
}

export const championsJob: JobDef = {
  name: "champions",
  // Hourly at :05 (server time); each group's Monday 09:00 is checked in its own timezone.
  cron: "5 * * * *",
  run: async (ctx) => {
    await runChampionsJob(ctx);
  },
};
