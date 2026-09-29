/**
 * Shapes stored in `ingest_events` (summary / errors). Defined ahead of the
 * ingest endpoint so the schema, sync status and admin views agree on them.
 *
 * Keep this file free of path aliases and runtime imports: src/db/schema.ts
 * imports these types.
 */

export type IngestAuthMethod = "bearer" | "query";

export const SLEEP_STAGES = ["in_bed", "asleep", "awake", "core", "deep", "rem"] as const;
export type SleepStage = (typeof SLEEP_STAGES)[number];

/** Inclusive range of local dates (`YYYY-MM-DD`). */
export type DateRange = { from: string; to: string };

/** Which known metric fields a day had values for, sent as explicit null, or left out. */
export type FieldInventory = {
  present: string[];
  nulls: string[];
  absent: string[];
};

/**
 * `summary` JSONB of an ingest event: what the request contained and what it
 * changed. Everything except `days` is optional so partial summaries (e.g. a
 * 400 that failed validation halfway) still fit.
 */
export type IngestSummary = {
  /** Number of days in the payload. */
  days: number;
  /** Min and max `date` in the payload; null when there were no days. */
  dateRange: DateRange | null;
  /**
   * Field inventory: `perDay` keyed by local date, plus `totals` counting in
   * how many days each field was present / null / absent.
   */
  fields?: {
    perDay: Record<string, FieldInventory>;
    totals: Record<string, { present: number; nulls: number; absent: number }>;
  };
  /** Payload keys we don't know (recorded, never stored in metric tables), with the number of days seen. */
  unknownFields?: Record<string, number>;
  hrHourlyCount?: number;
  sleepSegmentCount?: number;
  /** Sleep sources seen, and the stages each one wrote. */
  sleepSources?: Record<string, SleepStage[]>;
  rowsInserted?: number;
  rowsUpdated?: number;
};

/** `errors` JSONB: zod issues or a single reason (413, 429, 500). */
export type IngestErrors = {
  reason?: string;
  issues?: { path: (string | number)[]; message: string; code?: string }[];
};
