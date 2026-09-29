import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type { AdapterAccountType } from "next-auth/adapters";

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
