import postgres from "postgres";

/** Constant session-level advisory lock key: only the holder runs jobs. */
export const WORKER_LOCK_KEY = 4_847_400_001;

export type WorkerLock = {
  /** Is the dedicated lock connection still alive (i.e. do we still hold the lock)? */
  isAlive(): Promise<boolean>;
  /** Release the lock and close its connection. Safe to call twice. */
  release(): Promise<void>;
};

/**
 * Try to take the worker lock on a dedicated connection (never the app pool:
 * a session lock is tied to the connection, and closing it releases the lock,
 * including when the process dies). Returns null if someone else holds it.
 */
export async function tryAcquireWorkerLock(
  url: string,
  key: number = WORKER_LOCK_KEY,
): Promise<WorkerLock | null> {
  const conn = postgres(url, { max: 1, onnotice: () => {}, connect_timeout: 10 });
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await conn.end({ timeout: 5 }).catch(() => {});
  };
  try {
    const [row] = await conn<{ ok: boolean }[]>`select pg_try_advisory_lock(${String(key)}::bigint) as ok`;
    if (!row?.ok) {
      await close();
      return null;
    }
  } catch (err) {
    await close();
    throw err;
  }
  return {
    async isAlive() {
      if (closed) return false;
      try {
        await conn`select 1`;
        return true;
      } catch {
        return false;
      }
    },
    async release() {
      if (closed) return;
      try {
        await conn`select pg_advisory_unlock(${String(key)}::bigint)`;
      } catch {
        // the connection is gone, and with it the lock
      }
      await close();
    },
  };
}
