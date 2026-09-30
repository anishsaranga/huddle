import { readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { sql, type SQL } from "drizzle-orm";
import type { Db } from "@/lib/admin/db";
import { avatarDir } from "@/lib/avatar/serve";
import { getEnv } from "@/lib/env";
import { childLogger } from "@/lib/log";
import { addDays, isValidTimezone, todayIn } from "@/lib/tz";

const log = childLogger("retention");

/**
 * Daily data (metrics, hourly HR, sleep, scores) is kept for exactly this many
 * days per user, counted back from the user's local "today". A row whose local
 * date is `today - 365` is deleted; `today - 364` is kept, so a user always
 * has today plus the 364 days before it.
 */
export const RETENTION_DAYS = 365;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Avatar files younger than this are never removed (an upload writes the file before it updates the row). */
export const AVATAR_MIN_AGE_MS = HOUR_MS;

/**
 * The only file names we ever delete from AVATAR_DIR: `<user uuid>-<12 hex>.webp`
 * (see saveAvatarUpload), plus the `.<pid>.tmp` leftovers of an interrupted write.
 */
export const AVATAR_FILE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[0-9a-f]{12}\.webp(\.\d+\.tmp)?$/;

export type RetentionOptions = {
  /** Default: INGEST_LOG_RETENTION_DAYS (env, 90). */
  ingestLogRetentionDays?: number;
  /** Default: AVATAR_DIR resolution (`avatarDir()`). */
  avatarDir?: string;
  /** Default: 1 hour. */
  avatarMinAgeMs?: number;
};

export type RetentionResult = {
  dailyMetrics: number;
  hrHourly: number;
  sleepNights: number;
  sleepSegments: number;
  dailyScores: number;
  ingestEvents: number;
  avatarFiles: number;
};

/** Rows the statement deleted (postgres.js reports it as `count` on the result array). */
function affected(result: unknown): number {
  const n = (result as { count?: number | string } | null | undefined)?.count;
  return Number(n ?? 0);
}

/**
 * `(values ...) as cutoffs(tz, cutoff)`: for every distinct valid timezone among the users, the
 * newest local date to delete (`today - 365` in that timezone at `now`). Users without a (valid)
 * timezone fall back to UTC through `coalesce` in the statements below. The dummy first row keeps
 * the VALUES list non-empty.
 */
function cutoffTable(zones: string[], now: Date, utcCutoff: string): SQL {
  const rows = zones
    .filter((z) => isValidTimezone(z))
    .map((z) => sql`(${z}::text, ${addDays(todayIn(z, now), -RETENTION_DAYS)}::date)`);
  rows.unshift(sql`(${"__none__"}::text, ${utcCutoff}::date)`);
  return sql`(values ${sql.join(rows, sql`, `)}) as cutoffs(tz, cutoff)`;
}

/**
 * Delete expired data:
 *
 * - `daily_metrics`, `hr_hourly` (local_date), `sleep_nights`, `sleep_segments` (wake_date) and
 *   `daily_scores` older than 365 days relative to each user's local today (`users.timezone`, else UTC).
 *   One set-based DELETE per table joined to `users`; the per-timezone cutoffs come from a tiny VALUES
 *   list (one row per distinct timezone), so there is no per-user loop.
 * - `ingest_events` received more than `INGEST_LOG_RETENTION_DAYS` (default 90) before `now`.
 * - Orphaned avatar files in AVATAR_DIR (see `removeOrphanAvatars`).
 *
 * `now` is a parameter so tests (and the worker's injected clock) control the boundary. Safe to re-run.
 */
export async function runRetention(db: Db, now: Date, opts: RetentionOptions = {}): Promise<RetentionResult> {
  const started = Date.now();
  const utcCutoff = addDays(todayIn("UTC", now), -RETENTION_DAYS);
  const zoneRows = await db.execute<{ timezone: string }>(
    sql`select distinct timezone from users where timezone is not null`,
  );
  const cutoffs = cutoffTable(
    [...zoneRows].map((r) => r.timezone),
    now,
    utcCutoff,
  );

  /** DELETE FROM `table` t USING users u WHERE the row's date column is on or before the user's cutoff. */
  const purge = async (table: string, dateColumn: string) =>
    affected(
      await db.execute(sql`
        delete from ${sql.identifier(table)} t
        using users u
        where u.id = t.user_id
          and t.${sql.identifier(dateColumn)} <= coalesce(
            (select cutoffs.cutoff from ${cutoffs} where cutoffs.tz = u.timezone),
            ${utcCutoff}::date
          )`),
    );

  const result: RetentionResult = {
    dailyMetrics: await purge("daily_metrics", "local_date"),
    hrHourly: await purge("hr_hourly", "local_date"),
    sleepNights: await purge("sleep_nights", "wake_date"),
    sleepSegments: await purge("sleep_segments", "wake_date"),
    dailyScores: await purge("daily_scores", "local_date"),
    ingestEvents: 0,
    avatarFiles: 0,
  };

  const ingestDays = opts.ingestLogRetentionDays ?? getEnv().INGEST_LOG_RETENTION_DAYS;
  const ingestCutoff = new Date(now.getTime() - ingestDays * DAY_MS);
  result.ingestEvents = affected(await db.execute(sql`delete from ingest_events where received_at < ${ingestCutoff.toISOString()}::timestamptz`));

  result.avatarFiles = await removeOrphanAvatars(db, now, opts);

  log.info({ ...result, ingestLogRetentionDays: ingestDays, durationMs: Date.now() - started }, "retention run finished");
  return result;
}

/**
 * Remove upload files that no user references (`users.avatar_path`). Only files whose name matches
 * `AVATAR_FILE_PATTERN` and that are regular files older than `avatarMinAgeMs` (default 1 hour) are
 * candidates; anything else in the directory is left alone. A missing directory is not an error.
 * Returns how many files were deleted.
 */
export async function removeOrphanAvatars(db: Db, now: Date, opts: RetentionOptions = {}): Promise<number> {
  const dir = path.resolve(opts.avatarDir ?? avatarDir());
  const minAge = opts.avatarMinAgeMs ?? AVATAR_MIN_AGE_MS;

  let names: string[];
  try {
    names = await readdir(/*turbopackIgnore: true*/ dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw err;
  }
  const candidates = names.filter((n) => AVATAR_FILE_PATTERN.test(n));
  if (candidates.length === 0) return 0;

  // Read the references after listing the directory: a file uploaded in between is either
  // referenced by now or too young to be touched.
  const rows = await db.execute<{ avatar_path: string }>(
    sql`select avatar_path from users where avatar_path is not null`,
  );
  const referenced = new Set([...rows].map((r) => r.avatar_path));

  let removed = 0;
  for (const name of candidates) {
    if (referenced.has(name)) continue;
    const file = path.join(dir, name);
    try {
      const info = await stat(/*turbopackIgnore: true*/ file);
      if (!info.isFile() || now.getTime() - info.mtimeMs < minAge) continue;
      await unlink(/*turbopackIgnore: true*/ file);
      removed++;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      log.warn({ file: name, err: err instanceof Error ? err.message : String(err) }, "could not remove orphaned avatar");
    }
  }
  return removed;
}
