/**
 * Structural validation of an ingest payload (zod). Accepts the three
 * payload shapes, coerces Shortcut-style values (numeric strings, newline
 * joined columns) and range-checks every known metric from
 * src/lib/health/fields.ts. Anything that needs the user's timezone
 * (timestamps, "today") happens afterwards in ./normalize.ts.
 */

import { z } from "zod";
import { METRIC_FIELDS, type MetricFieldDef, type MetricName } from "@/lib/health/fields";
import { isRealDate } from "@/lib/tz";

export const MAX_DAYS = 366;
export const MAX_SEGMENTS = 5000;
/** Input rows per day's hr_hourly (after de-duplication at most 24 are stored). */
export const MAX_HR_ROWS_PER_DAY = 48;
/** Plausible heart rate for an hourly bucket (bpm). */
export const HR_RANGE = { min: 20, max: 250 } as const;
/** Most validation issues returned / stored. */
export const MAX_ISSUES = 50;

export type Issue = { path: (string | number)[]; message: string };

/* ------------------------------------------------------------------------ */
/* Numeric coercion                                                          */
/* ------------------------------------------------------------------------ */

const PLAIN_NUMBER_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const THOUSANDS_RE = /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/;

export type Numeric = { ok: true; value: number | null } | { ok: false };

/**
 * A number as a Shortcut may send it: a JSON number, `null`, or a string such
 * as `"7412"`, `"7412.0"`, `" 51 "` or `"7,412"` (comma thousands separators
 * only in the unambiguous `1,234,567.89` pattern). Empty / whitespace-only
 * strings mean "no value" (null): that's what an empty Shortcut variable
 * becomes. Anything else is rejected.
 */
export function parseNumeric(v: unknown): Numeric {
  if (v === null) return { ok: true, value: null };
  if (typeof v === "number") return Number.isFinite(v) ? { ok: true, value: v } : { ok: false };
  if (typeof v !== "string") return { ok: false };
  const s = v.replace(/[   ]/g, " ").trim();
  if (s === "") return { ok: true, value: null };
  let n: number;
  if (PLAIN_NUMBER_RE.test(s)) n = Number(s);
  else if (THOUSANDS_RE.test(s)) n = Number(s.replace(/,/g, ""));
  else return { ok: false };
  return Number.isFinite(n) ? { ok: true, value: n } : { ok: false };
}

const describe = (v: unknown) => {
  const s = JSON.stringify(v) ?? String(v);
  return s.length > 40 ? `${s.slice(0, 37)}...` : s;
};

/**
 * Normalize a metric value into its canonical unit: fractions for
 * percentage fields, rounding for int fields, then the range check.
 * Returns the value or an error message.
 */
export function normalizeMetricValue(field: MetricFieldDef, raw: number): number | string {
  let n = raw;
  if (field.fraction && n <= 1 && n * 100 >= field.min && n * 100 <= field.max) n = n * 100;
  if (field.type === "int") n = Math.round(n);
  else n = Math.round(n * 1e6) / 1e6;
  if (Object.is(n, -0)) n = 0;
  if (n < field.min || n > field.max) {
    return `out of range: ${raw} (allowed ${field.min}-${field.max} ${field.unit})`;
  }
  return n;
}

function metricSchema(field: MetricFieldDef) {
  return z.unknown().transform((v, ctx) => {
    const parsed = parseNumeric(v);
    if (!parsed.ok) {
      ctx.addIssue({ code: "custom", message: `expected a number, got ${describe(v)}` });
      return z.NEVER;
    }
    if (parsed.value === null) return null;
    const n = normalizeMetricValue(field, parsed.value);
    if (typeof n === "string") {
      ctx.addIssue({ code: "custom", message: n });
      return z.NEVER;
    }
    return n;
  });
}

/** A number in [min, max] (numeric strings ok), or null when empty / null. */
function numberInRange(min: number, max: number, opts: { int?: boolean } = {}) {
  return z.unknown().transform((v, ctx) => {
    const parsed = parseNumeric(v);
    if (!parsed.ok) {
      ctx.addIssue({ code: "custom", message: `expected a number, got ${describe(v)}` });
      return z.NEVER;
    }
    if (parsed.value === null) return null;
    const n = parsed.value;
    if (opts.int && !Number.isInteger(n)) {
      ctx.addIssue({ code: "custom", message: `expected an integer, got ${describe(v)}` });
      return z.NEVER;
    }
    if (n < min || n > max) {
      ctx.addIssue({ code: "custom", message: `out of range: ${n} (allowed ${min}-${max})` });
      return z.NEVER;
    }
    return n;
  });
}

/* ------------------------------------------------------------------------ */
/* Columns (newline-joined strings or arrays)                                */
/* ------------------------------------------------------------------------ */

/** Split a Shortcut "Combine Text with New Lines" column into lines. */
export function splitColumn(v: string): string[] {
  return v === "" ? [] : v.split(/\r\n|\n|\r/);
}

const isBlank = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");

/** Drop trailing blank cells, but never below `minLength`. */
export function trimTrailingBlanks<T>(col: T[], minLength = 0): T[] {
  let n = col.length;
  while (n > minLength && isBlank(col[n - 1])) n--;
  return n === col.length ? col : col.slice(0, n);
}

/**
 * Line up columns: the row count is the primary column's length without
 * trailing blank lines (a Shortcut often leaves a final newline); other
 * columns lose trailing blanks only down to that count, so an empty last
 * value ("50\n" for two rows) still counts as a row.
 */
export function fitColumns<C extends Record<string, unknown[] | undefined>>(primary: keyof C, cols: C): C {
  const n = trimTrailingBlanks(cols[primary] ?? []).length;
  const out: Record<string, unknown[] | undefined> = {};
  for (const [k, col] of Object.entries(cols)) out[k] = col && trimTrailingBlanks(col, n);
  return out as C;
}

const column = z.union([z.string(), z.array(z.unknown())]).transform((v) => (typeof v === "string" ? splitColumn(v) : v));

/**
 * Parse `v` with one schema chosen by its JS shape (array vs object), and
 * forward the issues with their natural paths. Clearer errors than a zod union.
 */
function arrayOrColumnar<A, C>(arrayForm: z.ZodType<A>, columnar: z.ZodType<C>, what: string, nullAs?: A) {
  return z.unknown().transform((v, ctx): A | C => {
    if (v === null && nullAs !== undefined) return nullAs;
    const schema = Array.isArray(v) ? arrayForm : v !== null && typeof v === "object" ? columnar : null;
    if (!schema) {
      ctx.addIssue({ code: "custom", message: `${what}: expected an array or an object of columns` });
      return z.NEVER;
    }
    const r = schema.safeParse(v);
    if (!r.success) {
      for (const iss of r.error.issues) {
        ctx.addIssue({ code: "custom", message: iss.message, path: iss.path as (string | number)[] });
      }
      return z.NEVER;
    }
    return r.data;
  });
}

function checkEqualLengths(cols: Record<string, unknown[] | undefined>, ctx: z.RefinementCtx): boolean {
  const lengths = Object.entries(cols).filter(([, c]) => c !== undefined) as [string, unknown[]][];
  const n = lengths[0]?.[1].length;
  if (lengths.some(([, c]) => c.length !== n)) {
    ctx.addIssue({
      code: "custom",
      message: `columns must have equal length (${lengths.map(([k, c]) => `${k}: ${c.length}`).join(", ")})`,
    });
    return false;
  }
  return true;
}

/* ------------------------------------------------------------------------ */
/* hr_hourly                                                                 */
/* ------------------------------------------------------------------------ */

/** One hourly heart-rate bucket: by local `hour`, or by `start` timestamp (resolved later). */
export type HrRowInput = {
  hour?: number;
  start?: string;
  avg: number | null;
  min: number | null;
  max: number | null;
};

const hrValue = numberInRange(HR_RANGE.min, HR_RANGE.max);
const hourValue = numberInRange(0, 23, { int: true });
const timestampString = z.string().trim().min(1, "empty timestamp").max(64, "timestamp too long");

const hrRow = z
  .object({
    hour: hourValue.optional(),
    start: timestampString.optional(),
    avg: hrValue.optional(),
    min: hrValue.optional(),
    max: hrValue.optional(),
  })
  .transform((r, ctx): HrRowInput => {
    const hour = r.hour ?? undefined;
    if (r.start === undefined && hour === undefined) {
      ctx.addIssue({ code: "custom", message: "each row needs `hour` (0-23) or `start` (timestamp)" });
      return z.NEVER;
    }
    return { hour, start: r.start, avg: r.avg ?? null, min: r.min ?? null, max: r.max ?? null };
  });

const hrColumnar = z
  .object({
    starts: column.optional(),
    hours: column.optional(),
    avg: column,
    min: column.optional(),
    max: column.optional(),
  })
  .transform((c, ctx): HrRowInput[] => {
    if ((c.starts === undefined) === (c.hours === undefined)) {
      ctx.addIssue({ code: "custom", message: "give exactly one of `starts` or `hours`" });
      return z.NEVER;
    }
    const key = c.starts ? "starts" : "hours";
    const cols = fitColumns(key, { [key]: c.starts ?? c.hours, avg: c.avg, min: c.min, max: c.max });
    if (!checkEqualLengths(cols, ctx)) return z.NEVER;
    const [starts, hours] = c.starts ? [cols.starts, undefined] : [undefined, cols.hours];
    const { avg: avgCol, min: minCol, max: maxCol } = cols;
    const rows: HrRowInput[] = [];
    let failed = false;
    const n = avgCol!.length;
    for (let i = 0; i < n; i++) {
      let rowFailed = false;
      const cell = (col: unknown[] | undefined, name: string, schema: z.ZodType<number | null>) => {
        if (!col) return null;
        const r = schema.safeParse(col[i]);
        if (r.success) return r.data;
        rowFailed = failed = true;
        ctx.addIssue({ code: "custom", message: r.error.issues[0].message, path: [name, i] });
        return null;
      };
      const avg = cell(avgCol, "avg", hrValue);
      const min = cell(minCol, "min", hrValue);
      const max = cell(maxCol, "max", hrValue);
      if (starts) {
        const s = starts[i];
        if (typeof s !== "string" || s.trim() === "" || s.length > 64) {
          failed = true;
          ctx.addIssue({ code: "custom", message: `expected a timestamp, got ${describe(s)}`, path: ["starts", i] });
          continue;
        }
        rows.push({ start: s.trim(), avg, min, max });
      } else {
        const hour = cell(hours, "hours", hourValue);
        if (hour === null) {
          if (!rowFailed) ctx.addIssue({ code: "custom", message: "missing hour", path: ["hours", i] });
          failed = true;
          continue;
        }
        rows.push({ hour, avg, min, max });
      }
    }
    return failed ? z.NEVER : rows;
  });

/** `null` is accepted and means "no hourly data" (clears the day, like []). */
const hrHourlySchema = arrayOrColumnar(z.array(hrRow), hrColumnar, "hr_hourly", [] as HrRowInput[]).superRefine((rows, ctx) => {
  if (rows.length > MAX_HR_ROWS_PER_DAY) {
    ctx.addIssue({ code: "custom", message: `at most ${MAX_HR_ROWS_PER_DAY} hr_hourly rows per day (got ${rows.length})` });
  }
});

/* ------------------------------------------------------------------------ */
/* Sleep segments                                                            */
/* ------------------------------------------------------------------------ */

/** A raw sleep segment: stage as sent (normalized later), timestamps as strings. */
export type SegmentInput = { stage: string | number; start: string; end: string; source: string };

const stageValue = z.union([z.string().max(64), z.number().int()]);
const sourceValue = z
  .string()
  .max(200)
  .nullish()
  .transform((s) => (s ?? "").trim());

const segmentRow = z
  .object({ stage: stageValue, start: timestampString, end: timestampString, source: sourceValue })
  .transform((s): SegmentInput => ({ stage: s.stage, start: s.start, end: s.end, source: s.source }));

const segmentColumnar = z
  .object({ stages: column, starts: column, ends: column, sources: column.optional() })
  .transform((c, ctx): SegmentInput[] => {
    const cols = fitColumns("starts", { stages: c.stages, starts: c.starts, ends: c.ends, sources: c.sources });
    if (!checkEqualLengths(cols, ctx)) return z.NEVER;
    const { stages, starts, ends, sources } = cols;
    const out: SegmentInput[] = [];
    let failed = false;
    for (let i = 0; i < stages!.length; i++) {
      const r = segmentRow.safeParse({
        stage: stages![i],
        start: starts![i],
        end: ends![i],
        source: sources ? sources[i] : undefined,
      });
      if (r.success) {
        out.push(r.data);
        continue;
      }
      failed = true;
      for (const iss of r.error.issues) {
        const field = String(iss.path[0] ?? "");
        const col = ({ stage: "stages", start: "starts", end: "ends", source: "sources" } as Record<string, string>)[field] ?? field;
        ctx.addIssue({ code: "custom", message: iss.message, path: [col, i] });
      }
    }
    return failed ? z.NEVER : out;
  });

const segmentsSchema = arrayOrColumnar(z.array(segmentRow), segmentColumnar, "sleep_segments");

/* ------------------------------------------------------------------------ */
/* Day and payload                                                           */
/* ------------------------------------------------------------------------ */

export const DAY_KEYS = new Set<string>(["date", "hr_hourly", "sleep_segments", ...METRIC_FIELDS.map((f) => f.name)]);
export const TOP_KEYS = new Set<string>(["days", "sleep_segments", "tz"]);
export const HR_ROW_KEYS = new Set<string>(["hour", "start", "avg", "min", "max"]);
export const HR_COLUMN_KEYS = new Set<string>(["starts", "hours", "avg", "min", "max"]);
export const SEGMENT_KEYS = new Set<string>(["stage", "start", "end", "source"]);
export const SEGMENT_COLUMN_KEYS = new Set<string>(["stages", "starts", "ends", "sources"]);

const dateSchema = z
  .string({ error: "date is required (YYYY-MM-DD)" })
  .refine(isRealDate, { message: "date must be a real date in YYYY-MM-DD form" });

const daySchema = z.object({
  date: dateSchema,
  ...Object.fromEntries(METRIC_FIELDS.map((f) => [f.name, metricSchema(f).optional()])),
  hr_hourly: hrHourlySchema.optional(),
  sleep_segments: segmentsSchema.optional(),
});

/** A validated day. `metrics` has exactly the known keys the payload carried (null = explicit clear). */
export type DayInput = {
  date: string;
  metrics: Partial<Record<MetricName, number | null>>;
  /** undefined = not sent (stored rows untouched); [] = clear the day. */
  hrHourly?: HrRowInput[];
  segments: SegmentInput[];
};

export type PayloadShape = "day" | "array" | "object";

export type ParsedPayload = {
  shape: PayloadShape;
  days: DayInput[];
  /** Top-level and per-day segments, pooled. */
  segments: SegmentInput[];
  /** Raw `tz` from the payload (validated later). */
  tz?: string;
};

export type ParseResult = { ok: true; payload: ParsedPayload } | { ok: false; issues: Issue[] };

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

export function detectShape(json: unknown): PayloadShape | null {
  if (Array.isArray(json)) return "array";
  if (isPlainObject(json)) return "days" in json ? "object" : "day";
  return null;
}

const topSchema = z.object({
  days: z.array(z.unknown(), { error: "days must be an array" }),
  sleep_segments: segmentsSchema.optional(),
  tz: z.string().max(64).optional(),
});

export function toIssues(error: z.ZodError, prefix: (string | number)[] = []): Issue[] {
  return error.issues.map((i) => ({
    path: [...prefix, ...i.path.map((p) => (typeof p === "symbol" ? String(p) : p))],
    message: i.message,
  }));
}

function toDay(raw: Record<string, unknown>, parsed: Record<string, unknown>): DayInput {
  const metrics: Partial<Record<MetricName, number | null>> = {};
  for (const f of METRIC_FIELDS) {
    if (Object.hasOwn(raw, f.name)) metrics[f.name] = (parsed[f.name] as number | null | undefined) ?? null;
  }
  const hr = parsed.hr_hourly as HrRowInput[] | null | undefined;
  return {
    date: parsed.date as string,
    metrics,
    hrHourly: Object.hasOwn(raw, "hr_hourly") ? (hr ?? []) : undefined,
    segments: (parsed.sleep_segments as SegmentInput[] | undefined) ?? [],
  };
}

/**
 * Validate a parsed JSON body. Issue paths follow the payload's own shape
 * (`[0, "steps"]` for an array, `["days", 0, "steps"]` for the object form).
 */
export function parsePayload(json: unknown): ParseResult {
  const shape = detectShape(json);
  if (!shape) {
    return { ok: false, issues: [{ path: [], message: "expected a Day object, an array of Days, or { days: [...] }" }] };
  }

  let rawDays: unknown[];
  let prefix: (string | number)[] = [];
  let topSegments: SegmentInput[] = [];
  let tz: string | undefined;
  const issues: Issue[] = [];

  if (shape === "object") {
    const top = topSchema.safeParse(json);
    if (!top.success) {
      issues.push(...toIssues(top.error));
      // Still report per-day problems when `days` itself is fine.
      const days = (json as Record<string, unknown>).days;
      if (!Array.isArray(days)) return { ok: false, issues };
      rawDays = days;
    } else {
      rawDays = top.data.days;
      topSegments = top.data.sleep_segments ?? [];
      tz = top.data.tz;
    }
    prefix = ["days"];
  } else if (shape === "array") {
    rawDays = json as unknown[];
  } else {
    rawDays = [json];
  }

  if (rawDays.length > MAX_DAYS) {
    return {
      ok: false,
      issues: [{ path: shape === "object" ? ["days"] : [], message: `at most ${MAX_DAYS} days per request (got ${rawDays.length})` }],
    };
  }
  if (rawDays.length === 0 && topSegments.length === 0 && issues.length === 0) {
    return { ok: false, issues: [{ path: prefix, message: "no days in the payload" }] };
  }

  const days: DayInput[] = [];
  rawDays.forEach((raw, i) => {
    const dayPrefix = shape === "day" ? [] : [...prefix, i];
    if (!isPlainObject(raw)) {
      issues.push({ path: dayPrefix, message: "expected a Day object" });
      return;
    }
    const r = daySchema.safeParse(raw);
    if (!r.success) {
      issues.push(...toIssues(r.error, dayPrefix));
      return;
    }
    days.push(toDay(raw, r.data as Record<string, unknown>));
  });

  const segments = [...topSegments, ...days.flatMap((d) => d.segments)];
  if (segments.length > MAX_SEGMENTS) {
    issues.push({ path: [], message: `at most ${MAX_SEGMENTS} sleep segments per request (got ${segments.length})` });
  }

  if (issues.length) return { ok: false, issues: issues.slice(0, MAX_ISSUES) };
  return { ok: true, payload: { shape, days, segments, tz } };
}
