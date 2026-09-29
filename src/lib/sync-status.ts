/**
 * Per-user sync summary for the admin Users list.
 *
 * The ingest tables (`daily_metrics`, `ingest_events`) don't exist yet, so
 * this returns nulls for everyone ("Never synced"). M3 (ingest) fills it in:
 * last successful sync time and the number of distinct days with data.
 */
export type SyncSummary = {
  /** Time of the user's most recent successful sync; null = never. */
  lastSyncAt: Date | null;
  /** Number of local dates with data; null = unknown / never synced. */
  daysCovered: number | null;
};

export async function getSyncSummaries(userIds: string[]): Promise<Map<string, SyncSummary>> {
  return new Map(userIds.map((id) => [id, { lastSyncAt: null, daysCovered: null }]));
}
