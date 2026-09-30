import type { Logger } from "pino";
import { db as defaultDb } from "@/db";
import { workerHeartbeats } from "@/db/schema";
import { childLogger } from "@/lib/log";

type Db = typeof defaultDb;

/** What every job run receives. `now` is injectable so tests control the clock. */
export type JobContext = {
  db: Db;
  log: Logger;
  now: () => Date;
};

export type JobDef = {
  /** Unique; also the `worker_heartbeats.job` key. */
  name: string;
  /** node-cron expression, evaluated in the server's local timezone. */
  cron: string;
  run: (ctx: JobContext) => Promise<void>;
  /** Also run once when the worker starts (after it wins the lock). */
  runOnStart?: boolean;
};

export type JobResult =
  | { status: "ok"; durationMs: number }
  | { status: "error"; durationMs: number; error: string }
  | { status: "skipped"; reason: "already-running" };

export type RegistryDeps = Partial<JobContext>;

export type JobRegistry = {
  registerJob(job: JobDef): void;
  /** Run a job now (cron tick, `runOnStart`, or an admin trigger). Only throws for an unknown name. */
  runJob(name: string): Promise<JobResult>;
  listJobs(): JobDef[];
  isRunning(name: string): boolean;
};

function errorText(err: unknown): string {
  const text = err instanceof Error ? (err.stack ?? err.message) : String(err);
  return text.slice(0, 4000);
}

/**
 * Job registry. Each run records a `worker_heartbeats` row (last_run_at when it
 * starts, last_ok_at / last_error when it ends), logs its duration, never lets
 * the job's error escape, and is skipped while a previous run of the same job
 * is still in flight (within this process; the advisory lock in lock.ts keeps
 * other processes from running jobs at all).
 */
export function createJobRegistry(deps: RegistryDeps = {}): JobRegistry {
  const jobs = new Map<string, JobDef>();
  const running = new Set<string>();
  const log = () => deps.log ?? childLogger("worker");
  const now = () => (deps.now ?? (() => new Date()))();

  async function heartbeat(name: string, patch: Partial<typeof workerHeartbeats.$inferInsert>) {
    try {
      const db = deps.db ?? defaultDb;
      await db
        .insert(workerHeartbeats)
        .values({ job: name, ...patch })
        .onConflictDoUpdate({ target: workerHeartbeats.job, set: patch });
    } catch (err) {
      log().error({ job: name, err }, "could not write worker heartbeat");
    }
  }

  return {
    registerJob(job) {
      if (jobs.has(job.name)) throw new Error(`Job "${job.name}" is already registered.`);
      jobs.set(job.name, job);
    },

    listJobs: () => [...jobs.values()],

    isRunning: (name) => running.has(name),

    async runJob(name) {
      const job = jobs.get(name);
      if (!job) throw new Error(`Unknown job "${name}".`);
      const jobLog = log().child({ job: name });
      if (running.has(name)) {
        jobLog.warn("previous run still in progress, skipping");
        return { status: "skipped", reason: "already-running" };
      }
      running.add(name);
      const startedAt = Date.now();
      try {
        await heartbeat(name, { lastRunAt: now() });
        try {
          await job.run({ db: deps.db ?? defaultDb, log: jobLog, now });
        } catch (err) {
          const durationMs = Date.now() - startedAt;
          jobLog.error({ err, durationMs }, "job failed");
          await heartbeat(name, { lastError: errorText(err) });
          return {
            status: "error",
            durationMs,
            error: err instanceof Error ? err.message : String(err),
          };
        }
        const durationMs = Date.now() - startedAt;
        jobLog.info({ durationMs }, "job finished");
        await heartbeat(name, { lastOkAt: now(), lastError: null });
        return { status: "ok", durationMs };
      } finally {
        running.delete(name);
      }
    },
  };
}

/* The process-wide registry used by the worker entry (and later the admin panel). */

const defaultRegistry = createJobRegistry();

export const registerJob = defaultRegistry.registerJob;
export const runJob = defaultRegistry.runJob;
export const listJobs = defaultRegistry.listJobs;
export const isJobRunning = defaultRegistry.isRunning;
