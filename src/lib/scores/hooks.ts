import { db } from "@/db";
import { childLogger } from "@/lib/log";
import { recomputeAfterIngest } from "@/lib/scores/recompute";

const log = childLogger("scores");

/**
 * Called after an ingest request has been stored, with every local date whose
 * data changed (metric days and sleep wake dates). Recomputes scores from the
 * earliest affected date through FORWARD_DAYS after the latest (capped at
 * tomorrow), since later baselines depend on these days. Errors are caught by
 * the caller and never fail the ingest request.
 */
export async function onDataIngested(userId: string, affectedDates: readonly string[]): Promise<void> {
  if (affectedDates.length === 0) return;
  const t0 = performance.now();
  const rows = await recomputeAfterIngest(db, userId, affectedDates);
  log.debug(
    { userId, dates: affectedDates.length, from: affectedDates[0], to: affectedDates.at(-1), rows, ms: Math.round(performance.now() - t0) },
    "scores recomputed",
  );
}
