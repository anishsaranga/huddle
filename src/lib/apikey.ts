import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, isNull, lte, or } from "drizzle-orm";
import { apiKeys, users } from "@/db/schema";
import type { Db, Executor } from "@/lib/admin/db";
import { requireEnv } from "@/lib/env";
import { childLogger } from "@/lib/log";
import type { IngestAuthMethod } from "@/lib/ingest/types";

/*
 * Personal sync keys for the iPhone Shortcut.
 *
 * Format: `gk_` + base64url(32 random bytes) = 3 + 43 = 46 characters.
 * Only HMAC-SHA256(API_KEY_PEPPER, key) is stored, so a DB leak alone can't
 * be used to sync. The plaintext is returned exactly once, when created.
 * Never log a key: log its id or `prefix_hint` (first 8 chars) instead.
 */

const log = childLogger("apikey");

export const API_KEY_PREFIX = "gk_";
export const API_KEY_LENGTH = 46;
export const API_KEY_PATTERN = /^gk_[A-Za-z0-9_-]{43}$/;
const PREFIX_HINT_LENGTH = 8;
/** `last_used_at` is written at most this often per key. */
export const LAST_USED_THROTTLE_MS = 60_000;

export function generateApiKey(): string {
  return API_KEY_PREFIX + randomBytes(32).toString("base64url");
}

/** Cheap syntactic check, done before any DB work. */
export function isWellFormedApiKey(key: unknown): key is string {
  return typeof key === "string" && API_KEY_PATTERN.test(key);
}

export function hashApiKey(key: string, pepper: string = requireEnv("API_KEY_PEPPER")): string {
  return createHmac("sha256", pepper).update(key, "utf8").digest("hex");
}

export function prefixHintOf(key: string): string {
  return key.slice(0, PREFIX_HINT_LENGTH);
}

/** Constant-time string equality (for secrets / their hashes already in memory). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export type ExtractedApiKey = { key: string; method: IngestAuthMethod };

/**
 * The key from `Authorization: Bearer <key>` (scheme is case-insensitive),
 * else from the `?key=` query parameter. Bearer wins when both are present.
 * Returns the raw value; validate it with `authenticateApiKey`.
 */
export function extractApiKey(request: Request): ExtractedApiKey | null {
  const header = request.headers.get("authorization");
  if (header) {
    const m = /^bearer[ \t]+(\S+)[ \t]*$/i.exec(header.trim());
    if (m) return { key: m[1], method: "bearer" };
  }
  let key: string | null = null;
  try {
    key = new URL(request.url).searchParams.get("key");
  } catch {
    key = null;
  }
  if (key) return { key, method: "query" };
  return null;
}

export type CreatedApiKey = { key: string; keyId: string; prefixHint: string; createdAt: Date };

/**
 * Revoke the user's active key (if any) and issue a new one, atomically.
 * Returns the plaintext key: the only time it's ever available.
 */
export async function createKeyForUser(db: Db, userId: string): Promise<CreatedApiKey> {
  const key = generateApiKey();
  const hash = hashApiKey(key);
  const prefixHint = prefixHintOf(key);
  const row = await db.transaction(async (tx) => {
    // Serialize concurrent regenerations for this user (the partial unique index would reject the loser anyway).
    await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update");
    await tx
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)));
    const [inserted] = await tx
      .insert(apiKeys)
      .values({ userId, hash, prefixHint })
      .returning({ id: apiKeys.id, createdAt: apiKeys.createdAt });
    return inserted;
  });
  log.info({ userId, keyId: row.id, prefixHint }, "api key created");
  return { key, keyId: row.id, prefixHint, createdAt: row.createdAt };
}

/**
 * Issue a key only if the user has no active one (onboarding). Returns the
 * new key, or null when an active key already exists (it can't be shown again).
 */
export async function ensureKeyForUser(db: Db, userId: string): Promise<CreatedApiKey | null> {
  const key = generateApiKey();
  const hash = hashApiKey(key);
  const prefixHint = prefixHintOf(key);
  const row = await db.transaction(async (tx) => {
    await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update");
    const [active] = await tx
      .select({ id: apiKeys.id })
      .from(apiKeys)
      .where(and(eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)))
      .limit(1);
    if (active) return null;
    const [inserted] = await tx
      .insert(apiKeys)
      .values({ userId, hash, prefixHint })
      .returning({ id: apiKeys.id, createdAt: apiKeys.createdAt });
    return inserted;
  });
  if (!row) return null;
  log.info({ userId, keyId: row.id, prefixHint }, "api key created (onboarding)");
  return { key, keyId: row.id, prefixHint, createdAt: row.createdAt };
}

/** Revoke every active key of the user. Returns how many were revoked. */
export async function revokeKeysForUser(executor: Executor, userId: string): Promise<number> {
  const revoked = await executor
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)))
    .returning({ id: apiKeys.id, prefixHint: apiKeys.prefixHint });
  if (revoked.length) {
    log.info({ userId, keyIds: revoked.map((r) => r.id) }, "api keys revoked");
  }
  return revoked.length;
}

export type KeyStatus = {
  active: boolean;
  prefixHint: string | null;
  createdAt: Date | null;
  lastUsedAt: Date | null;
};

/** The user's active key (hint and timestamps only; the key itself is never retrievable). */
export async function getKeyStatus(executor: Executor, userId: string): Promise<KeyStatus> {
  const [row] = await executor
    .select({ prefixHint: apiKeys.prefixHint, createdAt: apiKeys.createdAt, lastUsedAt: apiKeys.lastUsedAt })
    .from(apiKeys)
    .where(and(eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)))
    .limit(1);
  if (!row) return { active: false, prefixHint: null, createdAt: null, lastUsedAt: null };
  return { active: true, ...row };
}

export type ApiKeyPrincipal = {
  userId: string;
  keyId: string;
  username: string | null;
  timezone: string | null;
};

/**
 * Resolve a raw key to its user. Rejects malformed keys without touching the
 * DB, revoked keys, and keys of deactivated users. Bumps `last_used_at` at
 * most once a minute. Returns null on any failure (callers answer a bare 401).
 */
export async function authenticateApiKey(
  executor: Executor,
  rawKey: string | null | undefined,
  now: Date = new Date(),
): Promise<ApiKeyPrincipal | null> {
  if (!isWellFormedApiKey(rawKey)) return null;
  const hash = hashApiKey(rawKey);
  const [row] = await executor
    .select({
      keyId: apiKeys.id,
      hash: apiKeys.hash,
      lastUsedAt: apiKeys.lastUsedAt,
      userId: users.id,
      username: users.username,
      timezone: users.timezone,
    })
    .from(apiKeys)
    .innerJoin(users, eq(users.id, apiKeys.userId))
    .where(and(eq(apiKeys.hash, hash), isNull(apiKeys.revokedAt), isNull(users.deactivatedAt)))
    .limit(1);
  // The lookup is by hash; the in-memory re-check is constant-time defense in depth.
  if (!row || !safeEqual(row.hash, hash)) return null;

  if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() >= LAST_USED_THROTTLE_MS) {
    const cutoff = new Date(now.getTime() - LAST_USED_THROTTLE_MS);
    await executor
      .update(apiKeys)
      .set({ lastUsedAt: now })
      .where(
        and(
          eq(apiKeys.id, row.keyId),
          or(isNull(apiKeys.lastUsedAt), lte(apiKeys.lastUsedAt, cutoff)),
        ),
      );
  }
  return { userId: row.userId, keyId: row.keyId, username: row.username, timezone: row.timezone };
}
