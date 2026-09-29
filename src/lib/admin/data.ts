/**
 * Admin "Data" section: what each friend's devices actually send.
 *
 * - `getCoverage`: users x metrics grid (% of the last 30 local days with a value), 2 queries.
 * - `getUnknownFields`: payload keys Huddle doesn't use (from `ingest_events.summary`), 1 query.
 * - `getSleepSources`: sleep sources and the stages each writes, per user, 2 queries.
 * - `getIngestOverview` / `getIngestLog`: the per-user audit trail (paginated), and its lazily loaded parts.
 *
 * Plain functions over a Drizzle handle (the integration tests call them
 * directly). Authorization is the caller's job: pages and server actions call
 * `requireAdmin()` first.
 */

import { and, count, desc, eq, gte, isNull, lte, ne, sql, type SQL } from "drizzle-orm";
import { ingestEvents, users } from "@/db/schema";
import type { Db } from "@/lib/admin/db";
import { COVERAGE_COLUMNS, type CoverageColumn } from "@/lib/admin/coverage-columns";
import { METRIC_FIELDS } from "@/lib/health/fields";
import {
  SLEEP_STAGES,
  type IngestAuthMethod,
  type IngestErrors,
  type IngestSummary,
  type JsonType,
  type SleepStage,
} from "@/lib/ingest/types";
import { addDays, isValidTimezone, localDateOf } from "@/lib/tz";

/* ------------------------------------------------------------------------ */
/* Shared                                                                    */
/* ------------------------------------------------------------------------ */

export const COVERAGE_DAYS = 30;
/** Unknown fields and sleep sources look back this far (matches the raw-body retention). */
export const LOOKBACK_DAYS = 90;
export const INGEST_PAGE_SIZE = 25;
/** The raw body viewer shows at most this many characters. */
export const BODY_DISPLAY_LIMIT = 200 * 1024;

const DAY_MS = 86_400_000;

/** Just enough of a user to draw an avatar and a name. */
export type UserRef = {
  id: string;
  label: string;
  username: string | null;
  timezone: string | null;
  avatarKind: "dicebear" | "upload" | null;
  avatarConfig: unknown;
  avatarPath: string | null;
};

type UserColumns = {
  id: string;
  displayName: string | null;
  name: string | null;
  username: string | null;
  email: string;
  timezone: string | null;
  avatarKind: "dicebear" | "upload" | null;
  avatarConfig: unknown;
  avatarPath: string | null;
};

const userColumns = {
  id: users.id,
  displayName: users.displayName,
  name: users.name,
  username: users.username,
  email: users.email,
  timezone: users.timezone,
  avatarKind: users.avatarKind,
  avatarConfig: users.avatarConfig,
  avatarPath: users.avatarPath,
};

function toUserRef(u: UserColumns): UserRef {
  return {
    id: u.id,
    label: u.displayName ?? u.name ?? u.username ?? u.email,
    username: u.username,
    timezone: u.timezone,
    avatarKind: u.avatarKind,
    avatarConfig: u.avatarConfig,
    avatarPath: u.avatarPath,
  };
}

/** jsonb read through a raw query: the driver hands it over as text (Drizzle disables the JSON parser). */
function parseJson<T>(value: unknown): T | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/* ------------------------------------------------------------------------ */
/* Coverage                                                                  */
/* ------------------------------------------------------------------------ */

export type CoverageCell = {
  /** Days in the window with a value. */
  days: number;
  /** Percent of the window, rounded (0-100). */
  pct: number;
};

export type CoverageUser = UserRef & {
  /** First and last local date of this user's window (their own timezone). */
  window: { from: string; to: string };
  /** By column key. */
  cells: Record<string, CoverageCell>;
};

export type Coverage = {
  windowDays: number;
  columns: readonly CoverageColumn[];
  users: CoverageUser[];
};

const q = (name: string) => `"${name.replaceAll('"', '""')}"`;

/**
 * For every (non-deactivated) user, how many of the last `windowDays` local
 * dates (in the user's own timezone, ending today) have a value per metric,
 * per hourly-HR, per sleep night and per night with stages.
 *
 * Two queries, no matter how many users: the users, then one statement that
 * counts everything with a lateral aggregate per table.
 */
export async function getCoverage(
  db: Db,
  opts: { now?: Date; windowDays?: number } = {},
): Promise<Coverage> {
  const now = opts.now ?? new Date();
  const windowDays = opts.windowDays ?? COVERAGE_DAYS;

  const rows = await db
    .select(userColumns)
    .from(users)
    .where(isNull(users.deactivatedAt))
    .orderBy(users.createdAt, users.email);

  const windows = rows.map((u) => {
    const tz = u.timezone && isValidTimezone(u.timezone) ? u.timezone : "UTC";
    const to = localDateOf(now.getTime(), tz);
    return { id: u.id, from: addDays(to, -(windowDays - 1)), to };
  });

  const counts = new Map<string, Record<string, number>>();
  if (windows.length > 0) {
    const values = sql.join(
      windows.map((w) => sql`(${w.id}::uuid, ${w.from}::date, ${w.to}::date)`),
      sql`, `,
    );
    const metricCounts = sql.join(
      METRIC_FIELDS.map((f) => sql.raw(`count(*) filter (where dm.${q(f.column)} is not null)::int as ${q(f.name)}`)),
      sql`, `,
    );
    const result = await db.execute<Record<string, unknown>>(sql`
      select w.user_id as "userId", m.*, x."hr_hourly", x."sleep", x."sleep_stages"
      from (values ${values}) as w(user_id, d_from, d_to)
      cross join lateral (
        select ${metricCounts}
        from daily_metrics dm
        where dm.user_id = w.user_id and dm.local_date between w.d_from and w.d_to
      ) m
      cross join lateral (
        select
          (select count(distinct h.local_date)::int from hr_hourly h
            where h.user_id = w.user_id and h.local_date between w.d_from and w.d_to) as "hr_hourly",
          (select count(*)::int from sleep_nights s
            where s.user_id = w.user_id and s.wake_date between w.d_from and w.d_to) as "sleep",
          (select count(*)::int from sleep_nights s
            where s.user_id = w.user_id and s.wake_date between w.d_from and w.d_to and s.has_stages) as "sleep_stages"
      ) x
    `);
    for (const r of result) {
      const perUser: Record<string, number> = {};
      for (const c of COVERAGE_COLUMNS) perUser[c.key] = Number(r[c.key] ?? 0);
      counts.set(String(r.userId), perUser);
    }
  }

  return {
    windowDays,
    columns: COVERAGE_COLUMNS,
    users: rows.map((u, i) => {
      const perUser = counts.get(u.id) ?? {};
      const cells: Record<string, CoverageCell> = {};
      for (const c of COVERAGE_COLUMNS) {
        const days = Math.min(perUser[c.key] ?? 0, windowDays);
        cells[c.key] = { days, pct: Math.round((days / windowDays) * 100) };
      }
      return { ...toUserRef(u), window: { from: windows[i].from, to: windows[i].to }, cells };
    }),
  };
}

/* ------------------------------------------------------------------------ */
/* Unknown fields                                                            */
/* ------------------------------------------------------------------------ */

export type UnknownFieldRow = {
  name: string;
  /** Sum of the per-request counts (days, rows or segments that carried the key). */
  total: number;
  /** Requests that carried it. */
  requests: number;
  types: JsonType[];
  users: UserRef[];
  firstSeen: Date;
  lastSeen: Date;
};

/** Every unknown payload key seen in the last `lookbackDays`, most frequent first. */
export async function getUnknownFields(
  db: Db,
  opts: { now?: Date; lookbackDays?: number } = {},
): Promise<UnknownFieldRow[]> {
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - (opts.lookbackDays ?? LOOKBACK_DAYS) * DAY_MS);

  const events = await db
    .select({
      receivedAt: ingestEvents.receivedAt,
      unknown: sql<unknown>`${ingestEvents.summary} -> 'unknownFields'`,
      ...userColumns,
    })
    .from(ingestEvents)
    .innerJoin(users, eq(users.id, ingestEvents.userId))
    .where(
      and(
        gte(ingestEvents.receivedAt, since),
        lte(ingestEvents.receivedAt, now),
        sql`jsonb_typeof(${ingestEvents.summary} -> 'unknownFields') = 'object'`,
        sql`${ingestEvents.summary} -> 'unknownFields' <> '{}'::jsonb`,
      ),
    )
    .orderBy(ingestEvents.receivedAt);

  type Acc = { total: number; requests: number; types: Set<JsonType>; users: Map<string, UserRef>; first: Date; last: Date };
  const byName = new Map<string, Acc>();
  for (const e of events) {
    const fields = parseJson<Record<string, unknown>>(e.unknown);
    if (!isObject(fields)) continue;
    const user = toUserRef(e);
    for (const [name, info] of Object.entries(fields)) {
      const i = isObject(info) ? info : {};
      let acc = byName.get(name);
      if (!acc) {
        acc = { total: 0, requests: 0, types: new Set(), users: new Map(), first: e.receivedAt, last: e.receivedAt };
        byName.set(name, acc);
      }
      acc.total += typeof i.count === "number" ? i.count : 1;
      acc.requests += 1;
      if (Array.isArray(i.types)) for (const t of i.types) acc.types.add(t as JsonType);
      acc.users.set(user.id, user);
      if (e.receivedAt < acc.first) acc.first = e.receivedAt;
      if (e.receivedAt > acc.last) acc.last = e.receivedAt;
    }
  }

  return [...byName.entries()]
    .map(([name, a]) => ({
      name,
      total: a.total,
      requests: a.requests,
      types: [...a.types].sort(),
      users: [...a.users.values()].sort((x, y) => x.label.localeCompare(y.label)),
      firstSeen: a.first,
      lastSeen: a.last,
    }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}

/* ------------------------------------------------------------------------ */
/* Sleep sources                                                             */
/* ------------------------------------------------------------------------ */

export type SleepSourceRow = {
  /** Writing app/device as Health reports it ("Unknown source" when empty). */
  name: string;
  /** Stages this source has written, in canonical order. */
  stages: SleepStage[];
  /** Requests that carried segments from it. */
  requests: number;
  /** Nights (last 90 days) where this source's segments won the merge. */
  nightsChosen: number;
  lastSeen: Date;
};

export type UserSleepSources = { user: UserRef; sources: SleepSourceRow[] };

const isStage = (s: unknown): s is SleepStage => (SLEEP_STAGES as readonly unknown[]).includes(s);

/** Per user: the sleep sources seen in the last `lookbackDays` and the stages each wrote. */
export async function getSleepSources(
  db: Db,
  opts: { now?: Date; lookbackDays?: number } = {},
): Promise<UserSleepSources[]> {
  const now = opts.now ?? new Date();
  const lookback = opts.lookbackDays ?? LOOKBACK_DAYS;
  const since = new Date(now.getTime() - lookback * DAY_MS);
  const sinceDate = addDays(localDateOf(now.getTime(), "UTC"), -lookback);

  const [events, chosen] = await Promise.all([
    db
      .select({
        receivedAt: ingestEvents.receivedAt,
        sources: sql<unknown>`${ingestEvents.summary} -> 'sleepSources'`,
        ...userColumns,
      })
      .from(ingestEvents)
      .innerJoin(users, eq(users.id, ingestEvents.userId))
      .where(
        and(
          gte(ingestEvents.receivedAt, since),
          lte(ingestEvents.receivedAt, now),
          sql`jsonb_typeof(${ingestEvents.summary} -> 'sleepSources') = 'object'`,
          sql`${ingestEvents.summary} -> 'sleepSources' <> '{}'::jsonb`,
        ),
      )
      .orderBy(ingestEvents.receivedAt),
    db.execute<{ userId: string; source: string; nights: number }>(sql`
      select user_id as "userId", chosen_source as source, count(*)::int as nights
      from sleep_nights
      where wake_date >= ${sinceDate}::date
      group by user_id, chosen_source
    `),
  ]);

  type Acc = { stages: Set<SleepStage>; requests: number; last: Date };
  const perUser = new Map<string, { user: UserRef; sources: Map<string, Acc> }>();
  for (const e of events) {
    const map = parseJson<Record<string, unknown>>(e.sources);
    if (!isObject(map)) continue;
    let entry = perUser.get(e.id);
    if (!entry) perUser.set(e.id, (entry = { user: toUserRef(e), sources: new Map() }));
    for (const [source, stages] of Object.entries(map)) {
      let acc = entry.sources.get(source);
      if (!acc) entry.sources.set(source, (acc = { stages: new Set(), requests: 0, last: e.receivedAt }));
      acc.requests += 1;
      if (e.receivedAt > acc.last) acc.last = e.receivedAt;
      if (Array.isArray(stages)) for (const s of stages) if (isStage(s)) acc.stages.add(s);
    }
  }

  const chosenBy = new Map<string, number>();
  for (const c of chosen) chosenBy.set(`${c.userId}\u0000${c.source}`, Number(c.nights));

  return [...perUser.values()]
    .map(({ user, sources }) => ({
      user,
      sources: [...sources.entries()]
        .map(([name, a]) => ({
          name: name || "Unknown source",
          stages: SLEEP_STAGES.filter((s) => a.stages.has(s)),
          requests: a.requests,
          nightsChosen: chosenBy.get(`${user.id}\u0000${name}`) ?? 0,
          lastSeen: a.last,
        }))
        .sort((a, b) => b.nightsChosen - a.nightsChosen || b.requests - a.requests || a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.user.label.localeCompare(b.user.label));
}

/* ------------------------------------------------------------------------ */
/* Ingest log                                                                */
/* ------------------------------------------------------------------------ */

export type IngestFilter = "all" | "ok" | "errors";
export const INGEST_FILTERS: readonly IngestFilter[] = ["all", "ok", "errors"];

export function parseIngestFilter(value: unknown): IngestFilter {
  return INGEST_FILTERS.find((f) => f === value) ?? "all";
}

/** Per-user roll-up shown on the Data page (one link card per user). */
export type IngestOverviewRow = {
  user: UserRef;
  events: number;
  errors: number;
  lastAt: Date | null;
};

/** Every non-deactivated user with their ingest event counts (users without events included). */
export async function getIngestOverview(db: Db): Promise<IngestOverviewRow[]> {
  const rows = await db
    .select({
      ...userColumns,
      events: count(ingestEvents.id),
      errors: sql<number>`count(${ingestEvents.id}) filter (where ${ingestEvents.status} <> 200)`.mapWith(Number),
      lastAt: sql<Date | null>`max(${ingestEvents.receivedAt})`.mapWith((v) => (v ? new Date(v) : null)),
    })
    .from(users)
    .leftJoin(ingestEvents, eq(ingestEvents.userId, users.id))
    .where(isNull(users.deactivatedAt))
    .groupBy(users.id)
    .orderBy(users.createdAt, users.email);
  return rows.map((r) => ({
    user: toUserRef(r),
    events: Number(r.events),
    errors: r.errors,
    lastAt: r.lastAt,
  }));
}

export type IngestSummaryLite = Omit<IngestSummary, "fields">;

export type IngestLogRow = {
  id: number;
  receivedAt: Date;
  status: number;
  authMethod: IngestAuthMethod;
  bytes: number;
  durationMs: number;
  /** The summary without its (large) per-day field inventory: load that with `getIngestEventDetail`. */
  summary: IngestSummaryLite | null;
  errors: IngestErrors | null;
};

export type IngestLog = {
  user: UserRef;
  rows: IngestLogRow[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
  filter: IngestFilter;
};

function filterWhere(userId: string, filter: IngestFilter): SQL {
  const own = eq(ingestEvents.userId, userId);
  if (filter === "ok") return and(own, eq(ingestEvents.status, 200))!;
  if (filter === "errors") return and(own, ne(ingestEvents.status, 200))!;
  return own;
}

/**
 * One page of a user's ingest events, newest first. `page` is 1-based and is
 * clamped to the last page. Returns null when the user doesn't exist.
 */
export async function getIngestLog(
  db: Db,
  input: { userId: string; page?: number; filter?: IngestFilter; pageSize?: number },
): Promise<IngestLog | null> {
  const filter = input.filter ?? "all";
  const pageSize = input.pageSize ?? INGEST_PAGE_SIZE;
  const where = filterWhere(input.userId, filter);

  const [[userRow], [{ total }]] = await Promise.all([
    db.select(userColumns).from(users).where(eq(users.id, input.userId)).limit(1),
    db.select({ total: count() }).from(ingestEvents).where(where),
  ]);
  if (!userRow) return null;

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const requested = Number.isFinite(input.page) ? Math.floor(input.page as number) : 1;
  const page = Math.min(Math.max(1, requested), pageCount);

  const rows = await db
    .select({
      id: ingestEvents.id,
      receivedAt: ingestEvents.receivedAt,
      status: ingestEvents.status,
      authMethod: ingestEvents.authMethod,
      bytes: ingestEvents.bytes,
      durationMs: ingestEvents.durationMs,
      summary: sql<string | null>`${ingestEvents.summary} - 'fields'`,
      errors: ingestEvents.errors,
    })
    .from(ingestEvents)
    .where(where)
    .orderBy(desc(ingestEvents.receivedAt), desc(ingestEvents.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return {
    user: toUserRef(userRow),
    rows: rows.map((r) => ({ ...r, summary: parseJson<IngestSummaryLite>(r.summary) })),
    total: Number(total),
    page,
    pageCount,
    pageSize,
    filter,
  };
}

export type IngestEventDetail = {
  id: number;
  userId: string;
  /** Per-day and total field inventory (present / null / absent); null for requests that never got that far. */
  fields: IngestSummary["fields"] | null;
};

/** The heavy part of a summary: the per-day field inventory. Null when the event doesn't exist. */
export async function getIngestEventDetail(db: Db, id: number): Promise<IngestEventDetail | null> {
  const [row] = await db
    .select({
      id: ingestEvents.id,
      userId: ingestEvents.userId,
      fields: sql<unknown>`${ingestEvents.summary} -> 'fields'`,
    })
    .from(ingestEvents)
    .where(eq(ingestEvents.id, id))
    .limit(1);
  if (!row) return null;
  const fields = parseJson<NonNullable<IngestSummary["fields"]>>(row.fields);
  return { id: row.id, userId: row.userId, fields: isObject(fields) ? fields : null };
}

export type IngestEventBody = {
  /** Pretty-printed JSON (or the raw text for a body that wasn't JSON), at most `limit` characters. */
  text: string;
  /** The stored body is longer than what `text` shows. */
  truncated: boolean;
  /** Stored size of the body as JSON text, in bytes. */
  totalBytes: number;
  /** True when `text` is valid pretty-printed JSON (not cut off, not a raw-text fallback). */
  isJson: boolean;
};

/**
 * The raw request body of an event, fetched on demand. Bodies can be 3 MB, so
 * the database only ships up to `limit` characters of it: a body that fits is
 * pretty-printed, a bigger one is cut (as compact JSON text) with `truncated`
 * set. Returns null when the event doesn't exist, `{ text: "" }` when no body
 * was stored.
 */
export async function getIngestEventBody(
  db: Db,
  id: number,
  limit: number = BODY_DISPLAY_LIMIT,
): Promise<IngestEventBody | null> {
  const result = await db.execute<{ size: string | number | null; head: string | null; full: string | null }>(sql`
    select
      octet_length(body::text) as size,
      case when length(body::text) > ${limit} then left(body::text, ${limit}) end as head,
      case when length(body::text) <= ${limit} then body::text end as "full"
    from ingest_events
    where id = ${id}
  `);
  const row = result[0];
  if (!row) return null;
  if (row.size === null) return { text: "", truncated: false, totalBytes: 0, isJson: false };
  const totalBytes = Number(row.size);

  if (row.head !== null) {
    // Too big to pretty-print here: show the start of the compact JSON text.
    return { text: row.head, truncated: true, totalBytes, isJson: false };
  }
  const parsed = parseJson<unknown>(row.full);
  // A body that wasn't JSON is stored as a JSON string holding its first 64 KB.
  const isText = typeof parsed === "string";
  let text = isText ? (parsed as string) : JSON.stringify(parsed, null, 2);
  const truncated = text.length > limit;
  if (truncated) text = text.slice(0, limit);
  return { text, truncated, totalBytes, isJson: !isText && !truncated };
}
