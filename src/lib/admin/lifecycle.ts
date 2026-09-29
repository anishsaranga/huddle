import { eq } from "drizzle-orm";
import { db as defaultDb } from "@/db";
import { sessions } from "@/db/schema";
import { childLogger } from "@/lib/log";
import type { Executor } from "./db";

const log = childLogger("admin");

/**
 * Side effects of deactivating a user. Runs inside the deactivation
 * transaction. Today: end every session so they're signed out immediately.
 *
 * TODO(M3): also revoke the user's API keys here (set `api_keys.revoked_at`),
 * so a deactivated user's Shortcut stops syncing.
 */
export async function onUserDeactivated(
  userId: string,
  executor: Executor = defaultDb,
): Promise<{ sessionsDeleted: number }> {
  const gone = await executor
    .delete(sessions)
    .where(eq(sessions.userId, userId))
    .returning({ t: sessions.sessionToken });
  log.debug({ userId, sessionsDeleted: gone.length }, "user deactivated: sessions revoked");
  return { sessionsDeleted: gone.length };
}
