import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { allowedEmails, groupMembers, groups, sessions, users } from "@/db/schema";
import { addAllowedEmail, listAllowlist, removeAllowedEmail } from "@/lib/admin/allowlist";
import {
  addGroupMembers,
  countMembers,
  createGroup,
  deleteGroup,
  getGroupDetail,
  listGroups,
  removeGroupMember,
  updateGroup,
} from "@/lib/admin/groups";
import { onUserDeactivated } from "@/lib/admin/lifecycle";
import { deactivateUser, listAdminUsers, reactivateUser } from "@/lib/admin/users";
import { getSyncSummaries } from "@/lib/sync-status";

const ADMIN_EMAIL = "boss@example.com";

async function makeUser(email: string, extra: Partial<typeof users.$inferInsert> = {}) {
  const [u] = await db
    .insert(users)
    .values({ email, onboardedAt: new Date(), ...extra })
    .returning();
  return u;
}

async function makeAdmin() {
  return makeUser(ADMIN_EMAIL, { isAdmin: true, displayName: "Boss" });
}

async function makeSession(userId: string, token = `tok-${Math.random().toString(36).slice(2)}`) {
  await db.insert(sessions).values({ sessionToken: token, userId, expires: new Date(Date.now() + 86_400_000) });
  return token;
}

const sessionsOf = async (userId: string) =>
  (await db.select().from(sessions).where(eq(sessions.userId, userId))).length;

describe("allowlist", () => {
  it("adds an email, normalized to lowercase and trimmed", async () => {
    const admin = await makeAdmin();
    const r = await addAllowedEmail(db, {
      actorId: admin.id,
      email: "  Friend@Example.COM ",
      adminEmail: ADMIN_EMAIL,
    });
    expect(r).toEqual({ ok: true, email: "friend@example.com" });
    const rows = await db.select().from(allowedEmails);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ email: "friend@example.com", addedBy: admin.id });
  });

  it("rejects a duplicate, even with different casing", async () => {
    const admin = await makeAdmin();
    const input = { actorId: admin.id, adminEmail: ADMIN_EMAIL };
    expect((await addAllowedEmail(db, { ...input, email: "friend@example.com" })).ok).toBe(true);
    const again = await addAllowedEmail(db, { ...input, email: "FRIEND@example.com" });
    expect(again).toMatchObject({ ok: false, code: "duplicate" });
    expect(await db.select().from(allowedEmails)).toHaveLength(1);
  });

  it("rejects malformed input", async () => {
    const admin = await makeAdmin();
    const input = { actorId: admin.id, adminEmail: ADMIN_EMAIL };
    for (const email of ["", "   ", "not-an-email", "a@", 42, null, undefined]) {
      expect(await addAllowedEmail(db, { ...input, email })).toMatchObject({ ok: false, code: "invalid" });
    }
    expect(await db.select().from(allowedEmails)).toHaveLength(0);
  });

  it("doesn't store the admin address (it's always allowed)", async () => {
    const admin = await makeAdmin();
    const r = await addAllowedEmail(db, { actorId: admin.id, email: "BOSS@example.com", adminEmail: ADMIN_EMAIL });
    expect(r).toMatchObject({ ok: false, code: "admin_email" });
    expect(await db.select().from(allowedEmails)).toHaveLength(0);
  });

  it("removes an email and deletes that user's sessions, keeping the user", async () => {
    const admin = await makeAdmin();
    const friend = await makeUser("friend@example.com");
    const other = await makeUser("other@example.com");
    await db.insert(allowedEmails).values([{ email: "friend@example.com" }, { email: "other@example.com" }]);
    await makeSession(friend.id);
    await makeSession(friend.id);
    await makeSession(other.id);

    const r = await removeAllowedEmail(db, { email: " Friend@Example.com", adminEmail: ADMIN_EMAIL });
    expect(r).toEqual({ ok: true, email: "friend@example.com", sessionsDeleted: 2 });

    expect((await db.select().from(allowedEmails)).map((e) => e.email)).toEqual(["other@example.com"]);
    expect(await sessionsOf(friend.id)).toBe(0);
    expect(await sessionsOf(other.id)).toBe(1);
    // The user survives; they just can't sign in again.
    expect(await db.select().from(users).where(eq(users.id, friend.id))).toHaveLength(1);
    expect(admin.id).toBeTruthy();
  });

  it("removing an email with no user row works", async () => {
    await db.insert(allowedEmails).values({ email: "ghost@example.com" });
    const r = await removeAllowedEmail(db, { email: "ghost@example.com", adminEmail: ADMIN_EMAIL });
    expect(r).toMatchObject({ ok: true, sessionsDeleted: 0 });
  });

  it("reports removing an email that isn't listed", async () => {
    const r = await removeAllowedEmail(db, { email: "nobody@example.com", adminEmail: ADMIN_EMAIL });
    expect(r).toMatchObject({ ok: false, code: "not_found" });
  });

  it("refuses to remove the admin email (any casing) and leaves their sessions", async () => {
    const admin = await makeAdmin();
    await db.insert(allowedEmails).values({ email: ADMIN_EMAIL });
    await makeSession(admin.id);

    const r = await removeAllowedEmail(db, { email: "Boss@Example.com", adminEmail: ADMIN_EMAIL });
    expect(r).toMatchObject({ ok: false, code: "admin_email" });
    expect(await db.select().from(allowedEmails)).toHaveLength(1);
    expect(await sessionsOf(admin.id)).toBe(1);
  });

  it("lists the admin pinned first, with joined info, even when not stored", async () => {
    await makeAdmin();
    const friend = await makeUser("friend@example.com", { displayName: "Fred" });
    await db
      .insert(allowedEmails)
      .values([{ email: "friend@example.com" }, { email: "invited@example.com" }]);

    const list = await listAllowlist(db, "Boss@example.com");
    expect(list.map((e) => e.email)).toEqual(["boss@example.com", "friend@example.com", "invited@example.com"]);
    expect(list[0]).toMatchObject({ pinned: true, user: { displayName: "Boss" } });
    expect(list[1]).toMatchObject({ pinned: false, user: { id: friend.id, displayName: "Fred", deactivated: false } });
    expect(list[2]).toMatchObject({ pinned: false, user: null });
  });

  it("lists the admin once when they are also stored in the table", async () => {
    await db.insert(allowedEmails).values([{ email: ADMIN_EMAIL }, { email: "friend@example.com" }]);
    const list = await listAllowlist(db, ADMIN_EMAIL);
    expect(list.map((e) => e.email)).toEqual([ADMIN_EMAIL, "friend@example.com"]);
    expect(list.filter((e) => e.pinned)).toHaveLength(1);
  });
});

describe("groups", () => {
  it("creates a group with a trimmed name and a valid timezone", async () => {
    const r = await createGroup(db, { name: "  Sunday Runners ", timezone: "Europe/Berlin" });
    expect(r.ok).toBe(true);
    const [row] = await db.select().from(groups);
    expect(row).toMatchObject({ name: "Sunday Runners", timezone: "Europe/Berlin" });
  });

  it("validates name (1-40 chars) and timezone", async () => {
    const bad = [
      { name: "", timezone: "UTC" },
      { name: "   ", timezone: "UTC" },
      { name: "x".repeat(41), timezone: "UTC" },
      { name: "Ok", timezone: "Mars/Olympus" },
      { name: "Ok", timezone: "+05:30" },
      { name: "Ok", timezone: "" },
      { name: 5, timezone: "UTC" },
    ];
    for (const input of bad) {
      expect(await createGroup(db, input)).toMatchObject({ ok: false, code: "invalid" });
    }
    expect((await createGroup(db, { name: "x".repeat(40), timezone: "UTC" })).ok).toBe(true);
    expect(await db.select().from(groups)).toHaveLength(1);
  });

  it("renames a group and changes its timezone", async () => {
    const created = await createGroup(db, { name: "Old", timezone: "UTC" });
    if (!created.ok) throw new Error("setup failed");

    expect((await updateGroup(db, { id: created.id, name: " New " })).ok).toBe(true);
    let [row] = await db.select().from(groups);
    expect(row).toMatchObject({ name: "New", timezone: "UTC" });

    expect((await updateGroup(db, { id: created.id, timezone: "Asia/Kolkata" })).ok).toBe(true);
    [row] = await db.select().from(groups);
    expect(row).toMatchObject({ name: "New", timezone: "Asia/Kolkata" });

    expect(await updateGroup(db, { id: created.id, name: "" })).toMatchObject({ ok: false, code: "invalid" });
    expect(await updateGroup(db, { id: created.id, timezone: "Nope/Nope" })).toMatchObject({
      ok: false,
      code: "invalid",
    });
    expect(await updateGroup(db, { id: created.id })).toMatchObject({ ok: false, code: "invalid" });
    expect(
      await updateGroup(db, { id: "00000000-0000-4000-8000-000000000000", name: "Ghost" }),
    ).toMatchObject({ ok: false, code: "not_found" });
    expect(await updateGroup(db, { id: "not-a-uuid", name: "Ghost" })).toMatchObject({
      ok: false,
      code: "invalid",
    });
  });

  it("deleting a group cascades its memberships but keeps the users", async () => {
    const a = await makeUser("a@example.com");
    const b = await makeUser("b@example.com");
    const g = await createGroup(db, { name: "Doomed", timezone: "UTC" });
    const keep = await createGroup(db, { name: "Keeper", timezone: "UTC" });
    if (!g.ok || !keep.ok) throw new Error("setup failed");
    await addGroupMembers(db, { groupId: g.id, userIds: [a.id, b.id] });
    await addGroupMembers(db, { groupId: keep.id, userIds: [a.id] });

    expect((await deleteGroup(db, { id: g.id })).ok).toBe(true);

    expect((await db.select().from(groups)).map((x) => x.name)).toEqual(["Keeper"]);
    const memberships = await db.select().from(groupMembers);
    expect(memberships).toHaveLength(1);
    expect(memberships[0]).toMatchObject({ groupId: keep.id, userId: a.id });
    expect(await db.select().from(users)).toHaveLength(2);
    expect(await deleteGroup(db, { id: g.id })).toMatchObject({ ok: false, code: "not_found" });
  });

  it("adds members (skipping existing ones) and removes a member", async () => {
    const a = await makeUser("a@example.com", { displayName: "Ann" });
    const b = await makeUser("b@example.com", { displayName: "Bob" });
    const c = await makeUser("c@example.com", { displayName: "Cy" });
    const g = await createGroup(db, { name: "Team", timezone: "UTC" });
    if (!g.ok) throw new Error("setup failed");

    expect(await addGroupMembers(db, { groupId: g.id, userIds: [a.id, b.id] })).toEqual({ ok: true, added: 2 });
    // b is already in; only c is new. Duplicated ids in the input are harmless.
    expect(await addGroupMembers(db, { groupId: g.id, userIds: [b.id, c.id, c.id] })).toEqual({
      ok: true,
      added: 1,
    });
    expect(await countMembers(db, g.id)).toBe(3);

    const detail = await getGroupDetail(db, g.id);
    expect(detail?.members.map((m) => m.label)).toEqual(["Ann", "Bob", "Cy"]);
    expect(detail?.addable).toEqual([]);

    expect((await removeGroupMember(db, { groupId: g.id, userId: b.id })).ok).toBe(true);
    expect(await countMembers(db, g.id)).toBe(2);
    expect(await removeGroupMember(db, { groupId: g.id, userId: b.id })).toMatchObject({
      ok: false,
      code: "not_found",
    });

    // b is offered again for adding.
    const after = await getGroupDetail(db, g.id);
    expect(after?.addable.map((u) => u.id)).toEqual([b.id]);
    // Removing a member never deletes the user.
    expect(await db.select().from(users).where(eq(users.id, b.id))).toHaveLength(1);
  });

  it("won't add unknown or deactivated users, or to a missing group", async () => {
    const active = await makeUser("a@example.com");
    const gone = await makeUser("gone@example.com", { deactivatedAt: new Date() });
    const g = await createGroup(db, { name: "Team", timezone: "UTC" });
    if (!g.ok) throw new Error("setup failed");

    const r = await addGroupMembers(db, {
      groupId: g.id,
      userIds: [active.id, gone.id, "00000000-0000-4000-8000-000000000000"],
    });
    expect(r).toEqual({ ok: true, added: 1 });
    expect((await getGroupDetail(db, g.id))?.addable).toEqual([]);

    expect(
      await addGroupMembers(db, { groupId: "00000000-0000-4000-8000-000000000000", userIds: [active.id] }),
    ).toMatchObject({ ok: false, code: "not_found" });
    expect(await addGroupMembers(db, { groupId: g.id, userIds: [] })).toMatchObject({ ok: false, code: "invalid" });
    expect(await addGroupMembers(db, { groupId: g.id, userIds: ["nope"] })).toMatchObject({
      ok: false,
      code: "invalid",
    });
  });

  it("lists groups with member counts and a capped avatar preview", async () => {
    const g = await createGroup(db, { name: "Big", timezone: "UTC" });
    await createGroup(db, { name: "Empty", timezone: "UTC" });
    if (!g.ok) throw new Error("setup failed");
    const people = [];
    for (let i = 0; i < 6; i++) people.push(await makeUser(`p${i}@example.com`, { displayName: `Person ${i}` }));
    await addGroupMembers(db, { groupId: g.id, userIds: people.map((p) => p.id) });

    const list = await listGroups(db);
    const big = list.find((x) => x.name === "Big");
    const empty = list.find((x) => x.name === "Empty");
    expect(big?.memberCount).toBe(6);
    expect(big?.members.length).toBeGreaterThan(0);
    expect(big?.members.length).toBeLessThan(6);
    expect(empty).toMatchObject({ memberCount: 0, members: [] });
  });

  it("getGroupDetail returns null for malformed or unknown ids", async () => {
    expect(await getGroupDetail(db, "nope")).toBeNull();
    expect(await getGroupDetail(db, "00000000-0000-4000-8000-000000000000")).toBeNull();
  });
});

describe("users", () => {
  it("deactivates a user: sets deactivated_at and deletes their sessions only", async () => {
    const admin = await makeAdmin();
    const friend = await makeUser("friend@example.com");
    const other = await makeUser("other@example.com");
    await makeSession(friend.id);
    await makeSession(friend.id);
    await makeSession(other.id);
    await makeSession(admin.id);

    const r = await deactivateUser(db, { actorId: admin.id, userId: friend.id });
    expect(r).toEqual({ ok: true, sessionsDeleted: 2 });

    const [row] = await db.select().from(users).where(eq(users.id, friend.id));
    expect(row.deactivatedAt).toBeInstanceOf(Date);
    expect(await sessionsOf(friend.id)).toBe(0);
    expect(await sessionsOf(other.id)).toBe(1);
    expect(await sessionsOf(admin.id)).toBe(1);
  });

  it("deactivating twice keeps the original timestamp", async () => {
    const admin = await makeAdmin();
    const friend = await makeUser("friend@example.com");
    await deactivateUser(db, { actorId: admin.id, userId: friend.id });
    const [first] = await db.select().from(users).where(eq(users.id, friend.id));
    await makeSession(friend.id); // stray session
    expect((await deactivateUser(db, { actorId: admin.id, userId: friend.id })).ok).toBe(true);
    const [second] = await db.select().from(users).where(eq(users.id, friend.id));
    expect(second.deactivatedAt).toEqual(first.deactivatedAt);
    expect(await sessionsOf(friend.id)).toBe(0);
  });

  it("reactivates a user", async () => {
    const admin = await makeAdmin();
    const friend = await makeUser("friend@example.com");
    await deactivateUser(db, { actorId: admin.id, userId: friend.id });

    expect((await reactivateUser(db, { userId: friend.id })).ok).toBe(true);
    const [row] = await db.select().from(users).where(eq(users.id, friend.id));
    expect(row.deactivatedAt).toBeNull();
    expect(await reactivateUser(db, { userId: "00000000-0000-4000-8000-000000000000" })).toMatchObject({
      ok: false,
      code: "not_found",
    });
  });

  it("the admin can't deactivate themself", async () => {
    const admin = await makeAdmin();
    await makeSession(admin.id);

    const r = await deactivateUser(db, { actorId: admin.id, userId: admin.id });
    expect(r).toMatchObject({ ok: false, code: "self" });
    const [row] = await db.select().from(users).where(eq(users.id, admin.id));
    expect(row.deactivatedAt).toBeNull();
    expect(await sessionsOf(admin.id)).toBe(1);
  });

  it("rejects bad or unknown ids", async () => {
    const admin = await makeAdmin();
    expect(await deactivateUser(db, { actorId: admin.id, userId: "nope" })).toMatchObject({
      ok: false,
      code: "invalid",
    });
    expect(
      await deactivateUser(db, { actorId: admin.id, userId: "00000000-0000-4000-8000-000000000000" }),
    ).toMatchObject({ ok: false, code: "not_found" });
  });

  it("no admin account can be deactivated, whoever asks", async () => {
    const admin = await makeAdmin();
    const other = await makeUser("other@example.com");
    const r = await deactivateUser(db, { actorId: other.id, userId: admin.id });
    expect(r).toMatchObject({ ok: false, code: "admin" });
  });

  it("onUserDeactivated deletes the user's sessions (M3 adds key revocation here)", async () => {
    const u = await makeUser("u@example.com");
    const v = await makeUser("v@example.com");
    await makeSession(u.id);
    await makeSession(v.id);
    expect(await onUserDeactivated(u.id)).toEqual({ sessionsDeleted: 1 });
    expect(await sessionsOf(u.id)).toBe(0);
    expect(await sessionsOf(v.id)).toBe(1);
  });

  it("lists users with a status, and sync summaries are empty for now", async () => {
    const admin = await makeAdmin();
    const active = await makeUser("active@example.com");
    const fresh = await makeUser("fresh@example.com", { onboardedAt: null });
    const gone = await makeUser("gone@example.com", { deactivatedAt: new Date() });

    const rows = await listAdminUsers(db);
    const status = Object.fromEntries(rows.map((r) => [r.email, r.status]));
    expect(status).toEqual({
      [ADMIN_EMAIL]: "active",
      "active@example.com": "active",
      "fresh@example.com": "not_onboarded",
      "gone@example.com": "deactivated",
    });
    expect(rows.find((r) => r.id === admin.id)?.isAdmin).toBe(true);

    const sync = await getSyncSummaries([active.id, fresh.id, gone.id]);
    expect([...sync.values()]).toEqual([
      { lastSyncAt: null, daysCovered: null },
      { lastSyncAt: null, daysCovered: null },
      { lastSyncAt: null, daysCovered: null },
    ]);
  });
});
