import { randomUUID } from "node:crypto";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db, sql } from "@/db";
import {
  accounts,
  allowedEmails,
  apiKeys,
  championAwards,
  dailyMetrics,
  dailyScores,
  groupMembers,
  groups,
  hrHourly,
  ingestEvents,
  messages,
  reactions,
  sessions,
  sleepNights,
  sleepSegments,
  users,
} from "@/db/schema";

const session = vi.hoisted(() => ({ user: null as null | { id: string } }));
const auth = vi.hoisted(() => ({ signOut: vi.fn(async () => {}) }));
vi.mock("@/lib/session", () => ({
  requireUser: async () => {
    if (!session.user) throw new Error("not signed in");
    return session.user;
  },
}));
vi.mock("@/lib/auth", () => ({ signOut: auth.signOut }));

const { deleteAccount } = await import("@/lib/account/delete");
const { deleteAccountAction } = await import("@/lib/account/actions");

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "huddle-delete-"));
  vi.stubEnv("AVATAR_DIR", dir);
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});
beforeEach(() => {
  session.user = null;
  auth.signOut.mockClear();
  vi.stubEnv("ADMIN_EMAIL", "admin@example.com");
});

const exists = (f: string) => access(f).then(() => true, () => false);

/** A user with a row in every table that hangs off users, plus an allowlist entry and an avatar upload. */
async function seedFullUser(email: string, username: string) {
  const avatarPath = `${randomUUID()}-abcdef012345.webp`;
  const [u] = await db
    .insert(users)
    .values({ email, username, onboardedAt: new Date(), avatarKind: "upload", avatarPath, timezone: "UTC" })
    .returning();
  const id = u.id;
  await writeFile(path.join(dir, avatarPath), "img");
  await db.insert(allowedEmails).values({ email });
  await db.insert(accounts).values({ userId: id, type: "oidc", provider: "google", providerAccountId: `g-${username}`, access_token: "tok" });
  await db.insert(sessions).values({ sessionToken: `sess-${username}`, userId: id, expires: new Date(Date.now() + 86_400_000) });
  await db.insert(apiKeys).values({ userId: id, hash: `h-${username}`, prefixHint: "gk_abcde" });
  const [g] = await db.insert(groups).values({ name: `g-${username}`, timezone: "UTC" }).returning();
  await db.insert(groupMembers).values({ groupId: g.id, userId: id });
  await db.insert(dailyMetrics).values({ userId: id, localDate: "2026-09-28", steps: 1 });
  await db.insert(hrHourly).values({ userId: id, localDate: "2026-09-28", hour: 1, avg: 60 });
  await db.insert(sleepNights).values({ userId: id, wakeDate: "2026-09-28", chosenSource: "W", bedStart: new Date(), bedEnd: new Date() });
  await db.insert(sleepSegments).values({ userId: id, wakeDate: "2026-09-28", stage: "deep", startTs: new Date(), endTs: new Date() });
  await db.insert(dailyScores).values({ userId: id, localDate: "2026-09-28", recovery: 50 });
  await db.insert(ingestEvents).values({ userId: id, status: 200, authMethod: "bearer", bytes: 1, durationMs: 1 });
  const [msg] = await db.insert(messages).values({ groupId: g.id, userId: id, kind: "text", body: "still here" }).returning();
  await db.insert(reactions).values({ messageId: msg.id, userId: id, emoji: "🔥" });
  await db.insert(championAwards).values({ groupId: g.id, weekStart: "2026-09-21", category: "sleep", userId: id, messageId: msg.id });
  return { user: u, group: g, message: msg, avatarPath };
}

/** Every public table with a user_id column, so a table added later can't be forgotten. */
async function userOwnedTables(): Promise<string[]> {
  const rows = await sql<{ table_name: string }[]>`
    select table_name from information_schema.columns
    where table_schema = 'public' and column_name = 'user_id' order by table_name`;
  return rows.map((r) => r.table_name);
}

async function rowsOf(table: string, userId: string): Promise<number> {
  const [r] = await sql.unsafe<{ n: number }[]>(`select count(*)::int as n from "${table}" where user_id = $1`, [userId]);
  return r.n;
}

describe("schema: nothing blocks deleting a user", () => {
  it("every foreign key to users cascades or sets null", async () => {
    const rows = await sql<{ conrelid: string; confdeltype: string }[]>`
      select conrelid::regclass::text as conrelid, confdeltype from pg_constraint
      where contype = 'f' and confrelid = 'public.users'::regclass`;
    expect(rows.length).toBeGreaterThan(10);
    // 'c' = cascade, 'n' = set null
    expect(rows.filter((r) => r.confdeltype !== "c" && r.confdeltype !== "n")).toEqual([]);
    // The only set-null references are the ones the account deletion relies on.
    expect(rows.filter((r) => r.confdeltype === "n").map((r) => r.conrelid).sort()).toEqual(["allowed_emails", "messages"]);
  });
});

describe("deleteAccount", () => {
  it("deletes the user and everything they own, keeps their messages as 'Deleted user'", async () => {
    const me = await seedFullUser("me@example.com", "me_user");
    const other = await seedFullUser("other@example.com", "other_user");
    const tables = await userOwnedTables();
    expect(tables).toEqual(expect.arrayContaining([
      "accounts", "api_keys", "champion_awards", "daily_metrics", "daily_scores", "group_members",
      "hr_hourly", "ingest_events", "reactions", "sessions", "sleep_nights", "sleep_segments",
    ]));
    for (const t of tables) expect(await rowsOf(t, me.user.id), t).toBeGreaterThan(0);

    const r = await deleteAccount(db, me.user.id, "me_user");
    expect(r).toMatchObject({ ok: true, keysRevoked: 1 });

    expect(await db.select().from(users).where(eq(users.id, me.user.id))).toEqual([]);
    for (const t of tables) expect(await rowsOf(t, me.user.id), t).toBe(0);

    // Messages stay, authorless.
    const [msg] = await db.select().from(messages).where(eq(messages.id, me.message.id));
    expect(msg).toMatchObject({ body: "still here", userId: null, kind: "text" });
    // The award row went with the user; its message link isn't a problem.
    expect(await db.$count(championAwards, eq(championAwards.userId, me.user.id))).toBe(0);

    // Allowlist entry gone, avatar file gone.
    expect(await db.select().from(allowedEmails).where(eq(allowedEmails.email, "me@example.com"))).toEqual([]);
    expect(await exists(path.join(dir, me.avatarPath))).toBe(false);

    // The other user is untouched.
    for (const t of tables) expect(await rowsOf(t, other.user.id), t).toBeGreaterThan(0);
    expect(await db.select().from(allowedEmails).where(eq(allowedEmails.email, "other@example.com"))).toHaveLength(1);
    expect(await exists(path.join(dir, other.avatarPath))).toBe(true);
    expect(await db.$count(messages, eq(messages.userId, other.user.id))).toBe(1);
  });

  it("accepts the username case-insensitively, trimmed, with a leading @", async () => {
    const me = await seedFullUser("case@example.com", "case_user");
    expect((await deleteAccount(db, me.user.id, "  @Case_User ")).ok).toBe(true);
  });

  it("refuses a wrong or empty username and deletes nothing", async () => {
    const me = await seedFullUser("wrong@example.com", "wrong_user");
    for (const typed of ["", "wrong", "wrong_user2", "someone_else"]) {
      const r = await deleteAccount(db, me.user.id, typed);
      expect(r).toMatchObject({ ok: false, code: "confirm" });
    }
    expect(await db.select().from(users).where(eq(users.id, me.user.id))).toHaveLength(1);
    expect(await rowsOf("daily_metrics", me.user.id)).toBe(1);
    expect(await exists(path.join(dir, me.avatarPath))).toBe(true);
    expect(await db.select().from(allowedEmails).where(eq(allowedEmails.email, "wrong@example.com"))).toHaveLength(1);
    // Keys are still active (revocation rolled back with the refusal).
    expect(await db.$count(apiKeys, and(eq(apiKeys.userId, me.user.id)))).toBe(1);
    const [k] = await db.select().from(apiKeys).where(eq(apiKeys.userId, me.user.id));
    expect(k.revokedAt).toBeNull();
  });

  it("refuses the admin (by ADMIN_EMAIL and by the is_admin flag)", async () => {
    const byEmail = await seedFullUser("admin@example.com", "the_admin");
    expect(await deleteAccount(db, byEmail.user.id, "the_admin")).toMatchObject({ ok: false, code: "admin" });

    const flagged = await seedFullUser("flagged@example.com", "flagged_one");
    await db.update(users).set({ isAdmin: true }).where(eq(users.id, flagged.user.id));
    expect(await deleteAccount(db, flagged.user.id, "flagged_one")).toMatchObject({ ok: false, code: "admin" });

    expect(await db.$count(users)).toBe(2);
    expect(await exists(path.join(dir, byEmail.avatarPath))).toBe(true);
  });

  it("reports an unknown user", async () => {
    expect(await deleteAccount(db, "00000000-0000-4000-8000-000000000000", "x")).toMatchObject({ ok: false, code: "not_found" });
  });

  it("still succeeds when the avatar file is already gone", async () => {
    const me = await seedFullUser("nofile@example.com", "nofile_user");
    await rm(path.join(dir, me.avatarPath));
    expect((await deleteAccount(db, me.user.id, "nofile_user")).ok).toBe(true);
  });
});

describe("deleteAccountAction", () => {
  it("deletes, then signs out to /login?deleted=1", async () => {
    const me = await seedFullUser("act@example.com", "act_user");
    session.user = me.user;
    await deleteAccountAction("act_user");
    expect(await db.select().from(users).where(eq(users.id, me.user.id))).toEqual([]);
    expect(auth.signOut).toHaveBeenCalledWith({ redirectTo: "/login?deleted=1" });
  });

  it("returns the error and does not sign out on a wrong username", async () => {
    const me = await seedFullUser("act2@example.com", "act2_user");
    session.user = me.user;
    const r = await deleteAccountAction("nope");
    expect(r).toEqual({ ok: false, error: "That doesn't match your username." });
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(await db.select().from(users).where(eq(users.id, me.user.id))).toHaveLength(1);
  });

  it("explains that the admin can't be deleted", async () => {
    const admin = await seedFullUser("admin@example.com", "admin_user");
    session.user = admin.user;
    const r = await deleteAccountAction("admin_user");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/admin account can't be deleted/i);
    expect(auth.signOut).not.toHaveBeenCalled();
  });
});
