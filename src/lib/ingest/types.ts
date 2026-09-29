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

export type IngestPayloadShape = "series" | "days" | "day" | "array";

/** Inclusive range of local dates (`YYYY-MM-DD`). */
export type DateRange = { from: string; to: string };

/** Which known metric fields a day had values for, sent as explicit null, or left out. */
export type FieldInventory = {
  present: string[];
  nulls: string[];
  absent: string[];
};

/** JSON type of a value (`typeof`, with `null` and `array` split out). */
export type JsonType = "string" | "number" | "boolean" | "null" | "array" | "object";

/**
 * A payload key Huddle doesn't know. Keys of `unknownFields` are the plain
 * name for day-level keys, and `top.<name>`, `hr_hourly.<name>` or
 * `sleep_segments.<name>` for keys at those levels.
 */
export type UnknownFieldInfo = {
  /** How many objects (days, rows, segments; 1 for top level) carried the key. */
  count: number;
  /** JSON types of the values seen. */
  types: JsonType[];
};

/**
 * `summary` JSONB of an ingest event: what the request contained and what it
 * changed. Everything except `days` is optional so partial summaries (e.g. a
 * 400 that failed validation halfway) still fit.
 */
export type IngestSummary = {
  /** Payload shape: one Day, an array of Days, `{ days }`, or the columnar `{ series }` window form. */
  shape?: IngestPayloadShape;
  /** Number of distinct days in the payload. */
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
  /** Payload keys we don't know (recorded, never stored in metric tables). */
  unknownFields?: Record<string, UnknownFieldInfo>;
  /** Days that appeared more than once (merged, later keys win). */
  duplicateDates?: string[];
  /** hr_hourly rows stored, and in how many days hr_hourly was sent (and so replaced). */
  hrHourlyCount?: number;
  hrHourlyDays?: number;
  /** hr_hourly rows dropped, by reason (`no_avg`, `other_date`, `duplicate_hour`). */
  hrHourlyDropped?: Record<string, number>;
  /** Valid sleep segments received (after dropping, before nap filtering). */
  sleepSegmentCount?: number;
  /** Sleep sources seen, and the stages each one wrote. */
  sleepSources?: Record<string, SleepStage[]>;
  /** Stage names we couldn't map (segments dropped), with counts. */
  unknownStages?: Record<string, number>;
  /** Sleep segments dropped, by reason (`end_before_start`, `too_long`, `duplicate`, `future`, `too_old`). */
  droppedSegments?: Record<string, number>;
  /** Wake dates whose night was (re)written from this payload. */
  nights?: string[];
  nightsWritten?: number;
  /** Older nights recomputed because this payload's sessions overlapped them. */
  nightsRecomputed?: string[];
  napsIgnored?: number;
  rowsInserted?: number;
  rowsUpdated?: number;
  /** Timezone used for local dates/hours, and where it came from. */
  tz?: string;
  tzSource?: "payload" | "profile" | "default";
  /** A payload `tz` that wasn't a valid IANA zone (ignored). */
  tzIgnored?: string;
  /** The payload's `meta` (series shape): primitive values only, never stored as metrics. */
  meta?: Record<string, string | number | boolean | null>;
  /** Series shape: the window the Shortcut looked at. */
  window?: DateRange;
  /** Series shape: day-group starts not at local midnight that were rounded to the nearest one (a tz mismatch). */
  tzAdjustments?: number;
  /** Series shape, per metric: dates with more than one row (summed or averaged; the Shortcut forgot "Group By"). */
  multiValueDates?: Record<string, number>;
  /** Series shape, per metric: window dates up to yesterday set to null because the series had no row for them. */
  nullFilled?: Record<string, number>;
  /** Series shape, per metric (and `hr`): rows dropped because their date is outside the window. */
  outsideWindow?: Record<string, number>;
  /** Request body was gzip-compressed; `decodedBytes` is its decompressed size. */
  gzip?: boolean;
  decodedBytes?: number;
};

/** `errors` JSONB: zod issues or a single reason (413, 429, 500). */
export type IngestErrors = {
  reason?: string;
  detail?: string;
  issues?: { path: (string | number)[]; message: string; code?: string }[];
};
