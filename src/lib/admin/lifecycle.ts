import { eq } from "drizzle-orm";
import { db as defaultDb } from "@/db";
import { sessions } from "@/db/schema";
import { revokeKeysForUser } from "@/lib/apikey";
import { childLogger } from "@/lib/log";
import type { Executor } from "./db";

const log = childLogger("admin");

/**
 * Side effects of deactivating a user. Runs inside the deactivation
 * transaction: end every session so they're signed out immediately, and
 * revoke their API keys so their Shortcut stops syncing. (Keys of a
 * deactivated user are also refused at authentication time.)
 */
export async function onUserDeactivated(
  userId: string,
  executor: Executor = defaultDb,
): Promise<{ sessionsDeleted: number; keysRevoked: number }> {
  const gone = await executor
    .delete(sessions)
    .where(eq(sessions.userId, userId))
    .returning({ t: sessions.sessionToken });
  const keysRevoked = await revokeKeysForUser(executor, userId);
  log.debug({ userId, sessionsDeleted: gone.length, keysRevoked }, "user deactivated: sessions and keys revoked");
  return { sessionsDeleted: gone.length, keysRevoked };
}
