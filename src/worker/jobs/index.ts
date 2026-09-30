import { getEnv } from "@/lib/env";
import type { JobDef } from "../registry";

/**
 * Jobs the worker schedules. Add new jobs here (one file per job under this
 * folder). Cron expressions use the server's local timezone, so a job that
 * cares about a group's or user's timezone must work that out itself from
 * `ctx.now()`; run frequently (e.g. hourly) and act on what is due.
 */

/** Only with WORKER_EXAMPLE_JOB=1: a no-op that lets you watch the worker tick. */
const exampleJob: JobDef = {
  name: "example",
  cron: "*/1 * * * *",
  runOnStart: true,
  async run(ctx) {
    ctx.log.info({ at: ctx.now().toISOString() }, "example job ran");
  },
};

export const jobs: JobDef[] = [...(getEnv().WORKER_EXAMPLE_JOB === "1" ? [exampleJob] : [])];
