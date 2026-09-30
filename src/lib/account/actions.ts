"use server";

import { db } from "@/db";
import { signOut } from "@/lib/auth";
import { childLogger } from "@/lib/log";
import { requireUser } from "@/lib/session";
import { deleteAccount } from "./delete";

const log = childLogger("account");

const DELETED_REDIRECT = "/login?deleted=1";

/**
 * Delete the signed-in user's account after they typed their username. Server actions are public POST
 * endpoints, so the session is checked here. Only returns on failure; on success the session cookie is
 * cleared and the user lands on /login with a notice.
 */
export async function deleteAccountAction(confirmUsername: string): Promise<{ ok: false; error: string }> {
  const user = await requireUser();
  if (typeof confirmUsername !== "string" || confirmUsername.length > 100) {
    return { ok: false, error: "That doesn't match your username." };
  }
  try {
    const r = await deleteAccount(db, user.id, confirmUsername);
    if (!r.ok) return { ok: false, error: r.error };
  } catch (err) {
    log.error({ userId: user.id, err: err instanceof Error ? err.message : String(err) }, "account deletion failed");
    return { ok: false, error: "Something went wrong. Nothing was deleted. Try again." };
  }
  // The session row went with the user; this clears the cookie and redirects (it throws Next's redirect).
  await signOut({ redirectTo: DELETED_REDIRECT });
  return { ok: false, error: "Your account was deleted. Reload the page." };
}
