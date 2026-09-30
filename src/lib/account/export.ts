import type postgres from "postgres";
import { sql as defaultSql } from "@/db";
import { childLogger } from "@/lib/log";
import { SlidingWindowLimiter } from "@/lib/ratelimit";
import { isValidTimezone, todayIn } from "@/lib/tz";

const log = childLogger("export");

export const EXPORT_FORMAT_VERSION = 1;
export const EXPORT_RATE_LIMIT = 5;
export const EXPORT_RATE_WINDOW_MS = 60 * 60 * 1000;

const globalForLimit = globalThis as unknown as { __huddleExportLimiter?: SlidingWindowLimiter };

/** Per-user export limiter (5 per hour), cached on globalThis so dev HMR keeps the counts. */
export function getExportLimiter(): SlidingWindowLimiter {
  return (globalForLimit.__huddleExportLimiter ??= new SlidingWindowLimiter({
    limit: EXPORT_RATE_LIMIT,
    windowMs: EXPORT_RATE_WINDOW_MS,
  }));
}

/** `huddle-export-<username>-<YYYY-MM-DD>.json` (the date is the user's local date). */
export function exportFilename(user: { username: string | null; timezone: string | null }, now: Date): string {
  const name = (user.username ?? "user").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 40) || "user";
  const tz = user.timezone && isValidTimezone(user.timezone) ? user.timezone : "UTC";
  return `huddle-export-${name}-${todayIn(tz, now)}.json`;
}

type Sql = postgres.Sql;
type Section = {
  key: string;
  /** Rows per database round trip (ingest events carry whole request bodies, so they go in small batches). */
  batch: number;
  /** One JSON object per row (column `row`). `to_jsonb` renders dates as YYYY-MM-DD and timestamps as ISO strings. */
  query: (sql: Sql, userId: string) => postgres.PendingQuery<postgres.Row[]>;
};

/*
 * Every section selects a jsonb object so the keys are the database's snake_case column names and the
 * values are already JSON-safe. Nothing that authenticates is selected: no key hashes, no Auth.js
 * accounts/sessions/tokens.
 */
const SECTIONS: Section[] = [
  {
    key: "api_keys",
    batch: 100,
    query: (sql, id) => sql`
      select jsonb_build_object('id', id, 'prefix_hint', prefix_hint, 'created_at', created_at,
                                'revoked_at', revoked_at, 'last_used_at', last_used_at) as row
      from api_keys where user_id = ${id} order by created_at, id`,
  },
  {
    key: "groups",
    batch: 100,
    query: (sql, id) => sql`
      select jsonb_build_object('group_id', g.id, 'name', g.name, 'timezone', g.timezone, 'joined_at', gm.joined_at) as row
      from group_members gm join groups g on g.id = gm.group_id
      where gm.user_id = ${id} order by gm.joined_at, g.id`,
  },
  {
    key: "daily_metrics",
    batch: 500,
    query: (sql, id) => sql`
      select to_jsonb(t) - 'user_id' as row from daily_metrics t where user_id = ${id} order by local_date`,
  },
  {
    key: "hr_hourly",
    batch: 1000,
    query: (sql, id) => sql`
      select to_jsonb(t) - 'user_id' as row from hr_hourly t where user_id = ${id} order by local_date, hour`,
  },
  {
    key: "sleep_nights",
    batch: 500,
    query: (sql, id) => sql`
      select to_jsonb(t) - 'user_id' as row from sleep_nights t where user_id = ${id} order by wake_date`,
  },
  {
    key: "sleep_segments",
    batch: 1000,
    query: (sql, id) => sql`
      select to_jsonb(t) - 'user_id' as row from sleep_segments t where user_id = ${id} order by id`,
  },
  {
    key: "daily_scores",
    batch: 500,
    query: (sql, id) => sql`
      select to_jsonb(t) - 'user_id' as row from daily_scores t where user_id = ${id} order by local_date`,
  },
  {
    key: "ingest_events",
    batch: 10,
    query: (sql, id) => sql`
      select to_jsonb(t) - 'user_id' as row from ingest_events t where user_id = ${id} order by id`,
  },
  {
    key: "messages",
    batch: 500,
    query: (sql, id) => sql`
      select to_jsonb(t) - 'user_id' as row from messages t where user_id = ${id} order by id`,
  },
  {
    key: "reactions",
    batch: 1000,
    query: (sql, id) => sql`
      select to_jsonb(t) - 'user_id' as row from reactions t where user_id = ${id} order by message_id, emoji`,
  },
  {
    key: "champion_awards",
    batch: 500,
    query: (sql, id) => sql`
      select to_jsonb(t) - 'user_id' as row from champion_awards t where user_id = ${id} order by id`,
  },
];

/** Export section names, in output order (`profile` first, then the arrays). */
export const EXPORT_SECTIONS = ["profile", ...SECTIONS.map((s) => s.key)] as const;

/** The profile object: the user's own profile fields and account email. No auth data. */
async function readProfile(sql: Sql, userId: string): Promise<Record<string, unknown> | null> {
  const [r] = await sql<{ row: Record<string, unknown> }[]>`
    select jsonb_build_object(
      'id', id, 'email', email, 'name', name, 'username', username, 'display_name', display_name,
      'timezone', timezone, 'units', units, 'dob', dob, 'sex', sex, 'height_cm', height_cm,
      'weight_kg', weight_kg, 'max_hr', max_hr, 'step_goal', step_goal, 'sleep_goal_min', sleep_goal_min,
      'avatar_kind', avatar_kind, 'avatar_config', avatar_config, 'created_at', created_at,
      'onboarded_at', onboarded_at
    ) as row from users where id = ${userId}`;
  return r?.row ?? null;
}

/**
 * The export as a byte stream of one JSON document. Chunks are produced on demand (pull-based), one
 * database batch at a time, so memory stays bounded whatever the size of the history and a slow
 * client simply slows the queries down. Cancelling the stream stops iterating (closing any open
 * cursor). A failure mid-way errors the stream, so the download aborts rather than ending with a
 * truncated file that looks complete.
 */
export function createExportStream(
  userId: string,
  opts: { sql?: Sql; now?: Date } = {},
): ReadableStream<Uint8Array> {
  const sql = opts.sql ?? defaultSql;
  const now = opts.now ?? new Date();
  const enc = new TextEncoder();

  async function* chunks(): AsyncGenerator<string> {
    const started = Date.now();
    const profile = await readProfile(sql, userId);
    yield `{"exported_at":${JSON.stringify(now.toISOString())},"format_version":${EXPORT_FORMAT_VERSION},"profile":${JSON.stringify(profile)}`;
    const counts: Record<string, number> = {};
    for (const section of SECTIONS) {
      yield `,${JSON.stringify(section.key)}:[`;
      let n = 0;
      for await (const rows of section.query(sql, userId).cursor(section.batch)) {
        yield (n === 0 ? "" : ",") + rows.map((r) => JSON.stringify(r.row)).join(",");
        n += rows.length;
      }
      yield "]";
      counts[section.key] = n;
    }
    yield "}";
    log.info({ userId, rows: counts, durationMs: Date.now() - started }, "export streamed");
  }

  const it = chunks();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await it.next();
        if (done) controller.close();
        else controller.enqueue(enc.encode(value));
      } catch (err) {
        log.error({ userId, err: err instanceof Error ? err.message : String(err) }, "export failed");
        controller.error(err);
      }
    },
    async cancel() {
      await it.return(undefined);
    },
  });
}
