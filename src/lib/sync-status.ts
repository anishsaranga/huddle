import { and, count, desc, eq, inArray, max, min } from "drizzle-orm";
import { dailyMetrics, ingestEvents } from "@/db/schema";
import type { Executor } from "@/lib/admin/db";
import type { DateRange } from "@/lib/ingest/types";

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
};

export async function getSyncStatus(db: Executor, userId: string): Promise<SyncStatusResponse> {
  const [summaries, [latest]] = await Promise.all([
    getSyncSummaries(db, [userId]),
    db
      .select({ summary: ingestEvents.summary })
      .from(ingestEvents)
      .where(and(eq(ingestEvents.userId, userId), eq(ingestEvents.status, OK_STATUS)))
      .orderBy(desc(ingestEvents.receivedAt), desc(ingestEvents.id))
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
  };
}
