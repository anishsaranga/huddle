import { db } from "@/db";
import { authenticateApiKey, extractApiKey } from "@/lib/apikey";
import { childLogger } from "@/lib/log";
import { getCurrentUser } from "@/lib/session";
import { getSyncStatus } from "@/lib/sync-status";

export const dynamic = "force-dynamic";

const log = childLogger("sync-status");
const NO_STORE = { "Cache-Control": "no-store" };

/** Bare 401: no body, so a bad key reveals nothing. */
const unauthorized = () => new Response(null, { status: 401, headers: NO_STORE });

/**
 * GET /api/me/sync-status: the caller's sync summary. Accepts an API key
 * (`Authorization: Bearer gk_…` or `?key=`) or a session cookie. When a key
 * is supplied it must be valid, even if a session cookie is also present.
 */
export async function GET(request: Request) {
  let userId: string;
  const credentials = extractApiKey(request);
  if (credentials) {
    const principal = await authenticateApiKey(db, credentials.key);
    if (!principal) {
      log.info({ auth: credentials.method }, "sync-status: api key rejected");
      return unauthorized();
    }
    userId = principal.userId;
  } else {
    const user = await getCurrentUser();
    if (!user) return unauthorized();
    userId = user.id;
  }

  const status = await getSyncStatus(db, userId);
  return Response.json(status, { headers: NO_STORE });
}
