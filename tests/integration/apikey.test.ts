import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { apiKeys, users } from "@/db/schema";
import { deactivateUser } from "@/lib/admin/users";
import {
  authenticateApiKey,
  createKeyForUser,
  ensureKeyForUser,
  getKeyStatus,
  hashApiKey,
  LAST_USED_THROTTLE_MS,
  revokeKeysForUser,
} from "@/lib/apikey";

async function makeUser(email: string, extra: Partial<typeof users.$inferInsert> = {}) {
  const [u] = await db
    .insert(users)
    .values({ email, onboardedAt: new Date(), username: email.split("@")[0], timezone: "Europe/Berlin", ...extra })
    .returning();
  return u;
}

const keysOf = (userId: string) => db.select().from(apiKeys).where(eq(apiKeys.userId, userId));

describe("API keys", () => {
  it("creates a key that authenticates; only the HMAC and a hint are stored", async () => {
    const u = await makeUser("ada@example.com");
    const created = await createKeyForUser(db, u.id);
    expect(created.key).toMatch(/^gk_[A-Za-z0-9_-]{43}$/);

    const [row] = await keysOf(u.id);
    expect(row.hash).toBe(hashApiKey(created.key));
    expect(row.hash).not.toContain(created.key.slice(3));
    expect(row.prefixHint).toBe(created.key.slice(0, 8));
    expect(row.revokedAt).toBeNull();

    const principal = await authenticateApiKey(db, created.key);
    expect(principal).toEqual({ userId: u.id, keyId: row.id, username: "ada", timezone: "Europe/Berlin" });

    expect(await getKeyStatus(db, u.id)).toMatchObject({ active: true, prefixHint: row.prefixHint });
  });

  it("rejects unknown well-formed keys", async () => {
    await makeUser("x@example.com");
    expect(await authenticateApiKey(db, "gk_" + "A".repeat(43))).toBeNull();
  });

  it("regenerating revokes the old key", async () => {
    const u = await makeUser("bo@example.com");
    const first = await createKeyForUser(db, u.id);
    const second = await createKeyForUser(db, u.id);
    expect(second.key).not.toBe(first.key);

    expect(await authenticateApiKey(db, first.key)).toBeNull();
    expect((await authenticateApiKey(db, second.key))?.userId).toBe(u.id);

    const rows = await keysOf(u.id);
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.revokedAt === null)).toHaveLength(1);
    expect((await getKeyStatus(db, u.id)).prefixHint).toBe(second.prefixHint);
  });

  it("revoking stops the key working", async () => {
    const u = await makeUser("cy@example.com");
    const { key } = await createKeyForUser(db, u.id);
    expect(await revokeKeysForUser(db, u.id)).toBe(1);
    expect(await revokeKeysForUser(db, u.id)).toBe(0);
    expect(await authenticateApiKey(db, key)).toBeNull();
    expect(await getKeyStatus(db, u.id)).toEqual({ active: false, prefixHint: null, createdAt: null, lastUsedAt: null });
  });

  it("a deactivated user's key fails, and deactivation revokes it", async () => {
    const admin = await makeUser("admin@example.com", { isAdmin: true });
    const u = await makeUser("di@example.com");
    const { key } = await createKeyForUser(db, u.id);

    // Refused at auth time even before revocation.
    await db.update(users).set({ deactivatedAt: new Date() }).where(eq(users.id, u.id));
    expect(await authenticateApiKey(db, key)).toBeNull();
    await db.update(users).set({ deactivatedAt: null }).where(eq(users.id, u.id));
    expect(await authenticateApiKey(db, key)).not.toBeNull();

    expect(await deactivateUser(db, { actorId: admin.id, userId: u.id })).toMatchObject({ ok: true });
    const active = await db.select().from(apiKeys).where(and(eq(apiKeys.userId, u.id), isNull(apiKeys.revokedAt)));
    expect(active).toHaveLength(0);
    // Stays revoked after reactivation.
    await db.update(users).set({ deactivatedAt: null }).where(eq(users.id, u.id));
    expect(await authenticateApiKey(db, key)).toBeNull();
  });

  it("updates last_used_at, throttled to once a minute", async () => {
    const u = await makeUser("ed@example.com");
    const { key, keyId } = await createKeyForUser(db, u.id);
    const lastUsed = async () => (await db.select().from(apiKeys).where(eq(apiKeys.id, keyId)))[0].lastUsedAt;
    expect(await lastUsed()).toBeNull();

    const t0 = new Date("2026-09-29T10:00:00.000Z");
    await authenticateApiKey(db, key, t0);
    expect((await lastUsed())?.toISOString()).toBe(t0.toISOString());

    await authenticateApiKey(db, key, new Date(t0.getTime() + 30_000));
    expect((await lastUsed())?.toISOString()).toBe(t0.toISOString());

    const t2 = new Date(t0.getTime() + LAST_USED_THROTTLE_MS + 1_000);
    await authenticateApiKey(db, key, t2);
    expect((await lastUsed())?.toISOString()).toBe(t2.toISOString());
  });

  it("allows at most one active key per user (partial unique index)", async () => {
    const u = await makeUser("fi@example.com");
    await createKeyForUser(db, u.id);
    await expect(db.insert(apiKeys).values({ userId: u.id, hash: "deadbeef", prefixHint: "gk_xxxxx" })).rejects.toThrow();
    // Revoked rows don't count.
    await db.insert(apiKeys).values({ userId: u.id, hash: "deadbeef2", prefixHint: "gk_yyyyy", revokedAt: new Date() });
    expect(await keysOf(u.id)).toHaveLength(2);
  });

  it("concurrent regenerations leave exactly one active key", async () => {
    const u = await makeUser("gi@example.com");
    const results = await Promise.all([createKeyForUser(db, u.id), createKeyForUser(db, u.id), createKeyForUser(db, u.id)]);
    const active = (await keysOf(u.id)).filter((r) => r.revokedAt === null);
    expect(active).toHaveLength(1);
    const working = await Promise.all(results.map((r) => authenticateApiKey(db, r.key)));
    expect(working.filter(Boolean)).toHaveLength(1);
  });

  it("ensureKeyForUser only creates a key when none is active", async () => {
    const u = await makeUser("hu@example.com");
    const first = await ensureKeyForUser(db, u.id);
    expect(first?.key).toMatch(/^gk_/);
    expect(await ensureKeyForUser(db, u.id)).toBeNull();
    expect(await keysOf(u.id)).toHaveLength(1);
    await revokeKeysForUser(db, u.id);
    expect(await ensureKeyForUser(db, u.id)).not.toBeNull();
  });

  it("deleting the user cascades to their keys", async () => {
    const u = await makeUser("ja@example.com");
    await createKeyForUser(db, u.id);
    await db.delete(users).where(eq(users.id, u.id));
    expect(await keysOf(u.id)).toHaveLength(0);
  });
});
