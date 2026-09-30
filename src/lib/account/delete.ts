import { unlink } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { allowedEmails, users } from "@/db/schema";
import type { Db } from "@/lib/admin/db";
import { revokeKeysForUser } from "@/lib/apikey";
import { avatarDir, resolveUploadPath } from "@/lib/avatar/serve";
import { childLogger } from "@/lib/log";

const log = childLogger("account");

export type DeleteAccountResult =
  | { ok: true; keysRevoked: number }
  | { ok: false; code: "not_found" | "admin" | "confirm"; error: string };

export const ADMIN_DELETE_MESSAGE =
  "The admin account can't be deleted here. Change ADMIN_EMAIL first, or ask the person running Huddle.";

/** What the typed confirmation is compared against: trimmed, lowercased, without a leading "@". */
const normalizeTyped = (v: string) => v.trim().replace(/^@/, "").toLowerCase();

/**
 * Permanently delete the user and everything they own.
 *
 * In one transaction: revoke their API keys, remove their allowlist entry, delete the `users` row.
 * Every user-owned table references `users(id)` with ON DELETE CASCADE (accounts, sessions, api_keys,
 * group_members, daily_metrics, hr_hourly, sleep_nights, sleep_segments, daily_scores, ingest_events,
 * reactions, champion_awards), so they go with it and every session ends at once. Two references are
 * set null instead: `messages.user_id` (their chat messages stay and render as "Deleted user") and
 * `allowed_emails.added_by` (allowlist entries they added stay).
 *
 * The uploaded avatar file is removed after the commit (a file can't roll back). The admin
 * (ADMIN_EMAIL, or a user flagged is_admin) is refused. Logs the user id only.
 */
export async function deleteAccount(
  db: Db,
  userId: string,
  confirmUsername: string,
  opts: { adminEmail?: string; avatarDir?: string } = {},
): Promise<DeleteAccountResult> {
  const adminEmail = (opts.adminEmail ?? process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();

  const outcome = await db.transaction(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).for("update");
    if (!user) return { ok: false as const, code: "not_found" as const, error: "Account not found." };
    if (user.isAdmin || (adminEmail !== "" && user.email.toLowerCase() === adminEmail)) {
      return { ok: false as const, code: "admin" as const, error: ADMIN_DELETE_MESSAGE };
    }
    if (!user.username || normalizeTyped(confirmUsername) !== user.username.toLowerCase()) {
      return { ok: false as const, code: "confirm" as const, error: "That doesn't match your username." };
    }

    const keysRevoked = await revokeKeysForUser(tx, userId);
    await tx.delete(allowedEmails).where(eq(allowedEmails.email, user.email.toLowerCase()));
    await tx.delete(users).where(eq(users.id, userId));
    return { ok: true as const, keysRevoked, avatarPath: user.avatarPath };
  });

  if (!outcome.ok) {
    log.info({ userId, code: outcome.code }, "account deletion refused");
    return outcome;
  }

  if (outcome.avatarPath) {
    const file = resolveUploadPath(opts.avatarDir ?? avatarDir(), outcome.avatarPath);
    if (file) {
      await unlink(/*turbopackIgnore: true*/ file).catch((err: NodeJS.ErrnoException) => {
        // The row is already gone; a stray file is cleaned up by the retention job's orphan sweep.
        if (err.code !== "ENOENT") log.warn({ userId, err: err.message }, "could not remove avatar file");
      });
    }
  }
  log.info({ userId, keysRevoked: outcome.keysRevoked }, "account deleted");
  return { ok: true, keysRevoked: outcome.keysRevoked };
}
