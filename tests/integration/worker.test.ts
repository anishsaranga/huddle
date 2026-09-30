import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { workerHeartbeats } from "@/db/schema";
import { getWorkerStatus } from "@/lib/admin/worker";
import { createLogger } from "@/lib/log";
import { tryAcquireWorkerLock } from "@/worker/lock";
import { createJobRegistry } from "@/worker/registry";
import { TEST_DATABASE_URL } from "../support/test-db";

const quiet = () => createLogger({ write() {} }, { level: "silent" });

async function heartbeat(job: string) {
  const [row] = await db.select().from(workerHeartbeats).where(eq(workerHeartbeats.job, job));
  return row;
}

describe("job registry", () => {
  it("records last_run_at and last_ok_at on success, using the injected clock", async () => {
    const t = new Date("2026-09-28T10:00:00Z");
    const registry = createJobRegistry({ db, log: quiet(), now: () => t });
    let seenNow: Date | undefined;
    registry.registerJob({
      name: "ok-job",
      cron: "* * * * *",
      run: async (ctx) => {
        seenNow = ctx.now();
      },
    });
    const result = await registry.runJob("ok-job");
    expect(result.status).toBe("ok");
    expect(seenNow).toEqual(t);
    const row = await heartbeat("ok-job");
    expect(row.lastRunAt).toEqual(t);
    expect(row.lastOkAt).toEqual(t);
    expect(row.lastError).toBeNull();
  });

  it("records last_error on failure, keeps the last ok, and does not throw", async () => {
    let fail = false;
    let clock = new Date("2026-09-28T10:00:00Z");
    const registry = createJobRegistry({ db, log: quiet(), now: () => clock });
    registry.registerJob({
      name: "flaky",
      cron: "* * * * *",
      run: async () => {
        if (fail) throw new Error("boom");
      },
    });
    await registry.runJob("flaky");
    fail = true;
    clock = new Date("2026-09-28T11:00:00Z");
    const result = await registry.runJob("flaky");
    expect(result).toMatchObject({ status: "error", error: "boom" });
    const row = await heartbeat("flaky");
    expect(row.lastRunAt).toEqual(clock);
    expect(row.lastOkAt).toEqual(new Date("2026-09-28T10:00:00Z"));
    expect(row.lastError).toContain("boom");

    // A later success clears the error.
    fail = false;
    await registry.runJob("flaky");
    expect((await heartbeat("flaky")).lastError).toBeNull();
  });

  it("isolates one job's error from another job", async () => {
    const registry = createJobRegistry({ db, log: quiet() });
    let otherRan = false;
    registry.registerJob({ name: "bad", cron: "* * * * *", run: async () => Promise.reject(new Error("x")) });
    registry.registerJob({
      name: "good",
      cron: "* * * * *",
      run: async () => {
        otherRan = true;
      },
    });
    await registry.runJob("bad");
    await registry.runJob("good");
    expect(otherRan).toBe(true);
    expect((await getWorkerStatus(db)).map((r) => r.job)).toEqual(["bad", "good"]);
  });

  it("skips a run while the same job is still running", async () => {
    const registry = createJobRegistry({ db, log: quiet() });
    let release!: () => void;
    let runs = 0;
    registry.registerJob({
      name: "slow",
      cron: "* * * * *",
      run: () => {
        runs++;
        return new Promise<void>((r) => (release = r));
      },
    });
    const first = registry.runJob("slow");
    await waitFor(() => runs === 1);
    const second = await registry.runJob("slow");
    expect(second).toEqual({ status: "skipped", reason: "already-running" });
    release();
    expect((await first).status).toBe("ok");
    expect(runs).toBe(1);
    expect(registry.isRunning("slow")).toBe(false);
    // Once finished, it can run again.
    const third = registry.runJob("slow");
    await waitFor(() => runs === 2);
    release();
    expect((await third).status).toBe("ok");
  });

  it("rejects duplicate names and unknown jobs", async () => {
    const registry = createJobRegistry({ db, log: quiet() });
    registry.registerJob({ name: "a", cron: "* * * * *", run: async () => {} });
    expect(() => registry.registerJob({ name: "a", cron: "* * * * *", run: async () => {} })).toThrow();
    await expect(registry.runJob("nope")).rejects.toThrow(/Unknown job/);
  });
});

async function waitFor(cond: () => boolean) {
  for (let i = 0; i < 200; i++) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("condition not met");
}

describe("worker advisory lock", () => {
  it("lets only one holder at a time and frees the lock on release", async () => {
    const first = await tryAcquireWorkerLock(TEST_DATABASE_URL, 4_847_499_001);
    expect(first).not.toBeNull();
    expect(await first!.isAlive()).toBe(true);

    const second = await tryAcquireWorkerLock(TEST_DATABASE_URL, 4_847_499_001);
    expect(second).toBeNull();

    await first!.release();
    const third = await tryAcquireWorkerLock(TEST_DATABASE_URL, 4_847_499_001);
    expect(third).not.toBeNull();
    await third!.release();
  });
});
