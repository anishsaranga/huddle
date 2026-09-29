import { and, count, desc, eq, gte, inArray, max, min, sql } from "drizzle-orm";
import { dailyMetrics, ingestEvents } from "@/db/schema";
import type { Executor } from "@/lib/admin/db";
import type { DateRange, IngestErrors, IngestPayloadShape } from "@/lib/ingest/types";
import { summarizeIngestErrors, type LastAttempt } from "@/lib/sync/attempt";

/** Only successful syncs count as "synced". */
const OK_STATUS = 200;

/** Per-user sync summary (admin Users list, /api/me/sync-status). */
export type SyncSummary = {
  /** Time of the user's most recent successful sync; null = never. */
  lastSyncAt: Date | null;
  /** Number of local dates with a `daily_metrics` row (0 = none). */
  daysCovered: number;
  /** Earliest / latest local date with data (`YYYY-MM-DD`); null when none. */
  firstDate: string | null;
  lastDate: string | null;
};

export const EMPTY_SYNC_SUMMARY: SyncSummary = { lastSyncAt: null, daysCovered: 0, firstDate: null, lastDate: null };

/**
 * Sync summaries for many users in two grouped queries (no per-user queries).
 * Every requested id is present in the result, with empty values when the
 * user has never synced.
 */
export async function getSyncSummaries(db: Executor, userIds: string[]): Promise<Map<string, SyncSummary>> {
  const result = new Map<string, SyncSummary>(userIds.map((id) => [id, { ...EMPTY_SYNC_SUMMARY }]));
  if (userIds.length === 0) return result;

  const [syncs, coverage] = await Promise.all([
    db
      .select({ userId: ingestEvents.userId, lastSyncAt: max(ingestEvents.receivedAt) })
      .from(ingestEvents)
      .where(and(inArray(ingestEvents.userId, userIds), eq(ingestEvents.status, OK_STATUS)))
      .groupBy(ingestEvents.userId),
    db
      .select({
        userId: dailyMetrics.userId,
        days: count(),
        firstDate: min(dailyMetrics.localDate),
        lastDate: max(dailyMetrics.localDate),
      })
      .from(dailyMetrics)
      .where(inArray(dailyMetrics.userId, userIds))
      .groupBy(dailyMetrics.userId),
  ]);

  for (const s of syncs) {
    const entry = result.get(s.userId);
    if (entry) entry.lastSyncAt = s.lastSyncAt;
  }
  for (const c of coverage) {
    const entry = result.get(c.userId);
    if (!entry) continue;
    entry.daysCovered = c.days;
    entry.firstDate = c.firstDate;
    entry.lastDate = c.lastDate;
  }
  return result;
}

/** Response body of `GET /api/me/sync-status` (snake_case: it's read by the Shortcut and the Sync now poller). */
export type SyncStatusResponse = {
  last_sync_at: string | null;
  days_covered: number;
  first_date: string | null;
  last_date: string | null;
  /** Date range carried by the most recent successful sync; null when unknown / never synced. */
  last_payload_dates: DateRange | null;
  /**
   * The most recent ingest request of any status (the Sync now poller watches
   * it); null when there has never been one. 401s aren't recorded.
   */
  last_attempt: LastAttempt | null;
  /** The server's clock (ISO 8601), so the client can compare against `last_attempt.at`. */
  server_time: string;
};

export async function getSyncStatus(db: Executor, userId: string, now: Date = new Date()): Promise<SyncStatusResponse> {
  const newestFirst = [desc(ingestEvents.receivedAt), desc(ingestEvents.id)] as const;
  const [summaries, [latest], [attempt]] = await Promise.all([
    getSyncSummaries(db, [userId]),
    db
      .select({ summary: ingestEvents.summary })
      .from(ingestEvents)
      .where(and(eq(ingestEvents.userId, userId), eq(ingestEvents.status, OK_STATUS)))
      .orderBy(...newestFirst)
      .limit(1),
    db
      .select({
        receivedAt: ingestEvents.receivedAt,
        status: ingestEvents.status,
        shape: sql<string | null>`${ingestEvents.summary} ->> 'shape'`,
        errors: ingestEvents.errors,
      })
      .from(ingestEvents)
      .where(eq(ingestEvents.userId, userId))
      .orderBy(...newestFirst)
      .limit(1),
  ]);
  const s = summaries.get(userId) ?? EMPTY_SYNC_SUMMARY;
  const range = latest?.summary?.dateRange;
  return {
    last_sync_at: s.lastSyncAt ? s.lastSyncAt.toISOString() : null,
    days_covered: s.daysCovered,
    first_date: s.firstDate,
    last_date: s.lastDate,
    last_payload_dates:
      range && typeof range.from === "string" && typeof range.to === "string" ? { from: range.from, to: range.to } : null,
    last_attempt: attempt ? toLastAttempt(attempt) : null,
    server_time: now.toISOString(),
  };
}

const SHAPES = new Set<string>(["series", "days", "day", "array"]);

function toLastAttempt(row: {
  receivedAt: Date;
  status: number;
  shape: string | null;
  errors: IngestErrors | null;
}): LastAttempt {
  const out: LastAttempt = {
    at: row.receivedAt.toISOString(),
    status: row.status,
    shape: row.shape && SHAPES.has(row.shape) ? (row.shape as IngestPayloadShape) : null,
  };
  if (row.status !== OK_STATUS) {
    const error = summarizeIngestErrors(row.errors);
    if (error) out.error = error;
  }
  return out;
}

/**
 * Distinct UTC days with a successful sync in the last `days` days. Two or
 * more means the Shortcut runs without being tapped (the /setup page treats
 * that as "automation set up").
 */
export async function getRecentSyncDays(db: Executor, userId: string, days = 7, now: Date = new Date()): Promise<number> {
  const since = new Date(now.getTime() - days * 86_400_000);
  const [row] = await db
    .select({ n: sql<number>`count(distinct date_trunc('day', ${ingestEvents.receivedAt} at time zone 'UTC'))::int` })
    .from(ingestEvents)
    .where(and(eq(ingestEvents.userId, userId), eq(ingestEvents.status, OK_STATUS), gte(ingestEvents.receivedAt, since)));
  return row?.n ?? 0;
}
