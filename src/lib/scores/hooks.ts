import { childLogger } from "@/lib/log";

const log = childLogger("scores");

/**
 * Called after an ingest request has been stored, with every local date whose
 * data changed (metric days and sleep wake dates). M4 recomputes scores here
 * (the affected dates plus 30 days forward). Errors are caught by the caller
 * and never fail the ingest request.
 */
export async function onDataIngested(userId: string, affectedDates: readonly string[]): Promise<void> {
  log.debug({ userId, dates: affectedDates.length, from: affectedDates[0], to: affectedDates.at(-1) }, "data ingested");
}
