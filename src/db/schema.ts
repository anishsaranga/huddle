import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type PgIntegerBuilderInitial,
  type PgRealBuilderInitial,
} from "drizzle-orm/pg-core";
import type { AdapterAccountType } from "next-auth/adapters";
// Relative imports only: drizzle-kit loads this file without path aliases.
import { METRIC_FIELDS, type MetricField } from "../lib/health/fields";
import type { IngestAuthMethod, IngestErrors, IngestSummary, SleepStage } from "../lib/ingest/types";

/*
 * Identity tables follow the official @auth/drizzle-adapter Postgres shape
 * (same JS property names and column kinds) with snake_case SQL names and
 * Huddle's extra profile columns on `users`.
 */

export type AvatarKind = "dicebear" | "upload";
export type Units = "metric" | "imperial";
/**
 * Stored DiceBear config. Mirrors `AvatarConfig` in src/lib/avatar/key.ts
 * (kept inline so drizzle-kit can load this file without path aliases);
 * always validate with `parseAvatarConfig()` before trusting it.
 */
export type AvatarConfig = {
  v: 1;
  style: string;
  seed: string;
  options: Record<string, string | number | boolean>;
};

const tstz = (name: string) => timestamp(name, { mode: "date", withTimezone: true });

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Auth.js fields
    name: text("name"),
    /** Always stored lowercase (enforced by a CHECK constraint). */
    email: text("email").notNull().unique(),
    emailVerified: tstz("email_verified"),
    image: text("image"),
    // Huddle profile
    /** Set during onboarding. */
    username: text("username").unique(),
    displayName: text("display_name"),
    /** Forced on every sign-in: true iff email == ADMIN_EMAIL. */
    isAdmin: boolean("is_admin").notNull().default(false),
    deactivatedAt: tstz("deactivated_at"),
    onboardedAt: tstz("onboarded_at"),
    avatarKind: text("avatar_kind").$type<AvatarKind>(),
    avatarConfig: jsonb("avatar_config").$type<AvatarConfig>(),
    avatarPath: text("avatar_path"),
    timezone: text("timezone"),
    units: text("units").$type<Units>(),
    dob: date("dob"),
    sex: text("sex"),
    heightCm: real("height_cm"),
    weightKg: real("weight_kg"),
    maxHr: integer("max_hr"),
    stepGoal: integer("step_goal"),
    sleepGoalMin: integer("sleep_goal_min"),
    createdAt: tstz("created_at").notNull().defaultNow(),
  },
  (t) => [
    check("users_email_lowercase", sql`${t.email} = lower(${t.email})`),
    check("users_avatar_kind", sql`${t.avatarKind} in ('dicebear', 'upload')`),
    check("users_units", sql`${t.units} in ('metric', 'imperial')`),
  ],
);

export type User = typeof users.$inferSelect;

export const accounts = pgTable(
  "accounts",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (t) => [
    primaryKey({ columns: [t.provider, t.providerAccountId] }),
    index("accounts_user_id_idx").on(t.userId),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    sessionToken: text("session_token").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expires: tstz("expires").notNull(),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: tstz("expires").notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

/** Emails allowed to sign in. Stored lowercase. */
export const allowedEmails = pgTable(
  "allowed_emails",
  {
    email: text("email").primaryKey(),
    addedBy: uuid("added_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: tstz("created_at").notNull().defaultNow(),
  },
  (t) => [check("allowed_emails_email_lowercase", sql`${t.email} = lower(${t.email})`)],
);

export const groups = pgTable("groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("UTC"),
  createdAt: tstz("created_at").notNull().defaultNow(),
});

export const groupMembers = pgTable(
  "group_members",
  {
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    joinedAt: tstz("joined_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.groupId, t.userId] }),
    index("group_members_user_id_idx").on(t.userId),
  ],
);

/* ------------------------------------------------------------------------ */
/* API keys                                                                  */
/* ------------------------------------------------------------------------ */

/**
 * Personal sync keys (`gk_` + 43 base64url chars). Only an HMAC-SHA256 of the
 * full key (peppered with API_KEY_PEPPER) is stored; `prefix_hint` is the
 * first 8 characters for display. At most one active key per user.
 */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    hash: text("hash").notNull().unique(),
    prefixHint: text("prefix_hint").notNull(),
    createdAt: tstz("created_at").notNull().defaultNow(),
    revokedAt: tstz("revoked_at"),
    lastUsedAt: tstz("last_used_at"),
  },
  (t) => [
    uniqueIndex("api_keys_one_active_per_user").on(t.userId).where(sql`${t.revokedAt} is null`),
    index("api_keys_user_id_idx").on(t.userId),
  ],
);

export type ApiKey = typeof apiKeys.$inferSelect;

/* ------------------------------------------------------------------------ */
/* Health data                                                               */
/* ------------------------------------------------------------------------ */

type MetricColumns = {
  [F in MetricField as F["name"]]: F["type"] extends "int" ? PgIntegerBuilderInitial<string> : PgRealBuilderInitial<string>;
};

/** One nullable column per metric in src/lib/health/fields.ts (int -> integer, float -> real). */
function metricColumns(): MetricColumns {
  return Object.fromEntries(
    METRIC_FIELDS.map((f) => [f.name, f.type === "int" ? integer(f.column) : real(f.column)]),
  ) as MetricColumns;
}

/** One row per user per local date. Every metric is nullable (null = no value). */
export const dailyMetrics = pgTable(
  "daily_metrics",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    localDate: date("local_date", { mode: "string" }).notNull(),
    ...metricColumns(),
    createdAt: tstz("created_at").notNull().defaultNow(),
    updatedAt: tstz("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.localDate] })],
);

export type DailyMetrics = typeof dailyMetrics.$inferSelect;

/** Heart rate per local hour (0-23). A day's rows are replaced when the day is re-sent. */
export const hrHourly = pgTable(
  "hr_hourly",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    localDate: date("local_date", { mode: "string" }).notNull(),
    hour: smallint("hour").notNull(),
    min: real("min"),
    avg: real("avg").notNull(),
    max: real("max"),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.localDate, t.hour] }),
    check("hr_hourly_hour", sql`${t.hour} between 0 and 23`),
  ],
);

/**
 * Raw sleep analysis samples as sent by the Shortcut, assigned to the local
 * date of the session's end (`wake_date`).
 */
export const sleepSegments = pgTable(
  "sleep_segments",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    wakeDate: date("wake_date", { mode: "string" }).notNull(),
    stage: text("stage").$type<SleepStage>().notNull(),
    startTs: tstz("start_ts").notNull(),
    endTs: tstz("end_ts").notNull(),
    /** Writing app/device as reported by Health ("" when unknown). */
    source: text("source").notNull().default(""),
  },
  (t) => [
    index("sleep_segments_user_wake_idx").on(t.userId, t.wakeDate),
    check("sleep_segments_stage", sql`${t.stage} in ('in_bed', 'asleep', 'awake', 'core', 'deep', 'rem')`),
    check("sleep_segments_order", sql`${t.endTs} >= ${t.startTs}`),
  ],
);

/** Merged per-night summary (computed at ingest from the winning source's segments). */
export const sleepNights = pgTable(
  "sleep_nights",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    wakeDate: date("wake_date", { mode: "string" }).notNull(),
    chosenSource: text("chosen_source").notNull(),
    bedStart: tstz("bed_start").notNull(),
    bedEnd: tstz("bed_end").notNull(),
    inBedMin: real("in_bed_min"),
    asleepMin: real("asleep_min"),
    awakeMin: real("awake_min"),
    coreMin: real("core_min"),
    deepMin: real("deep_min"),
    remMin: real("rem_min"),
    hasStages: boolean("has_stages").notNull().default(false),
    updatedAt: tstz("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.wakeDate] })],
);

/** Huddle's own scores per local date (filled in M4). */
export const dailyScores = pgTable(
  "daily_scores",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    localDate: date("local_date", { mode: "string" }).notNull(),
    sleepScore: real("sleep_score"),
    recovery: real("recovery"),
    strain: real("strain"),
    components: jsonb("components").$type<Record<string, unknown>>(),
    computedAt: tstz("computed_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.localDate] })],
);

/**
 * Audit trail of every authenticated ingest request (success or not).
 * Unauthenticated 401s are never stored. `body` is pruned after
 * INGEST_LOG_RETENTION_DAYS; the API key is never part of it.
 */
export const ingestEvents = pgTable(
  "ingest_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    receivedAt: tstz("received_at").notNull().defaultNow(),
    status: smallint("status").notNull(),
    authMethod: text("auth_method").$type<IngestAuthMethod>().notNull(),
    bytes: integer("bytes").notNull(),
    durationMs: integer("duration_ms").notNull(),
    summary: jsonb("summary").$type<IngestSummary>(),
    body: jsonb("body").$type<unknown>(),
    errors: jsonb("errors").$type<IngestErrors>(),
  },
  (t) => [
    index("ingest_events_user_received_idx").on(t.userId, t.receivedAt.desc()),
    index("ingest_events_received_idx").on(t.receivedAt),
    check("ingest_events_auth_method", sql`${t.authMethod} in ('bearer', 'query')`),
  ],
);

export type IngestEvent = typeof ingestEvents.$inferSelect;
