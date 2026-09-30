/**
 * Huddle background worker: `npm run worker` (or `worker:dev` to watch).
 *
 * A separate process from the Next server. It takes a Postgres session
 * advisory lock on a dedicated connection so only one worker runs jobs at a
 * time (a second one logs and retries every 30 s), then schedules the jobs from
 * ./jobs with node-cron. Cron expressions are evaluated in the *server's local
 * timezone* (the process TZ), not UTC; jobs that care about a group's or user's
 * timezone work that out themselves.
 *
 * Keep this entry (and everything under src/worker) free of Next-only imports
 * (`server-only`, `next/*`) so it can be bundled with esbuild later.
 */
import * as cron from "node-cron";
import { closeDb } from "@/db";
import { getEnv, requireEnv } from "@/lib/env";
import { childLogger } from "@/lib/log";
import { tryAcquireWorkerLock, type WorkerLock } from "./lock";
import { createJobRegistry } from "./registry";

try {
  process.loadEnvFile(".env");
} catch {
  // fall back to the real environment
}

const RETRY_MS = 30_000;
const SHUTDOWN_WAIT_MS = 15_000;

async function main() {
  getEnv(); // fail fast on a bad environment
  const log = childLogger("worker");
  const url = requireEnv("DATABASE_URL");

  // Imported after loadEnvFile so job modules can read env at import time.
  const { jobs } = await import("./jobs");
  const registry = createJobRegistry();
  for (const job of jobs) {
    if (!cron.validate(job.cron)) throw new Error(`Job "${job.name}" has an invalid cron expression: ${job.cron}`);
    registry.registerJob(job);
  }

  let lock: WorkerLock | null = null;
  let tasks: cron.ScheduledTask[] = [];
  let timer: NodeJS.Timeout | undefined;
  let stopping = false;

  function startJobs() {
    tasks = registry.listJobs().map((job) =>
      cron.schedule(job.cron, () => void registry.runJob(job.name), { name: job.name }),
    );
    log.info(
      { jobs: registry.listJobs().map((j) => ({ name: j.name, cron: j.cron })), tz: process.env.TZ ?? "server-local" },
      "worker started, jobs scheduled",
    );
    for (const job of registry.listJobs()) if (job.runOnStart) void registry.runJob(job.name);
  }

  async function stopJobs() {
    const current = tasks;
    tasks = [];
    await Promise.all(current.map(async (t) => (await t.destroy())));
  }

  async function check() {
    if (stopping) return;
    try {
      if (lock && !(await lock.isAlive())) {
        log.error("lost the worker lock connection, stopping jobs and retrying");
        await stopJobs();
        await lock.release();
        lock = null;
      }
      if (!lock) {
        lock = await tryAcquireWorkerLock(url);
        if (lock) startJobs();
        else log.info({ retryInSeconds: RETRY_MS / 1000 }, "another worker holds the lock, waiting");
      }
    } catch (err) {
      log.error({ err }, "worker lock check failed");
    }
    if (!stopping) timer = setTimeout(() => void check(), RETRY_MS);
  }

  async function shutdown(signal: string) {
    if (stopping) return;
    stopping = true;
    log.info({ signal }, "shutting down");
    if (timer) clearTimeout(timer);
    await stopJobs();
    const deadline = Date.now() + SHUTDOWN_WAIT_MS;
    while (registry.listJobs().some((j) => registry.isRunning(j.name)) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 200));
    }
    await lock?.release();
    await closeDb();
    log.info("worker stopped");
    // Let pino's transport flush before exiting.
    setTimeout(() => process.exit(0), 100);
  }

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await check();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
