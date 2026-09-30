import { runRetention, type RetentionResult } from "@/lib/retention";
import type { JobContext, JobDef } from "../registry";

/** Nightly data retention (see src/lib/retention.ts), with the job's clock. */
export async function runRetentionJob(ctx: JobContext): Promise<RetentionResult> {
  const result = await runRetention(ctx.db, ctx.now());
  ctx.log.info({ ...result }, "retention job done");
  return result;
}

export const retentionJob: JobDef = {
  name: "retention",
  // 03:17 server time, off the hour so it doesn't line up with other cron work.
  cron: "17 3 * * *",
  run: async (ctx) => {
    await runRetentionJob(ctx);
  },
};
