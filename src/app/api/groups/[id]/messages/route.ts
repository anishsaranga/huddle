import { db } from "@/db";
import { listMessages, MAX_PAGE } from "@/lib/chat/service";
import { CHAT_PAGE_SIZE } from "@/lib/chat/types";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

const ID = /^\d{1,15}$/;

/** undefined = absent, null = malformed. */
function positiveInt(raw: string | null): number | undefined | null {
  if (raw === null) return undefined;
  if (!ID.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * GET /api/groups/:id/messages: chat history as the viewer sees it
 * (ascending by id; `{ messages, hasMore }`).
 *   ?before=<id>[&limit=n]   older page (history scroll)
 *   ?after=<id>[&limit=n]    newer than id (catch-up)
 *   ?ids=1,2,3               exactly these (live refetch after an SSE event)
 * No parameters = the newest page. 401 without an onboarded session, 404 for
 * non-members, 400 for malformed parameters.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/groups/[id]/messages">) {
  const user = await getCurrentUser();
  if (!user?.onboardedAt) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const sp = new URL(request.url).searchParams;
  const before = positiveInt(sp.get("before"));
  const after = positiveInt(sp.get("after"));
  const limit = positiveInt(sp.get("limit"));
  const idsRaw = sp.get("ids");
  const ids = idsRaw === null ? undefined : idsRaw.split(",").map((s) => positiveInt(s.trim()));
  if (
    before === null ||
    after === null ||
    limit === null ||
    ids?.some((n) => n == null) ||
    (ids && ids.length > MAX_PAGE)
  ) {
    return Response.json({ error: "bad request" }, { status: 400 });
  }

  const page = await listMessages(db, id, user.id, {
    before,
    after,
    ids: ids as number[] | undefined,
    limit: limit ?? CHAT_PAGE_SIZE,
  });
  if (!page) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(page, { headers: { "Cache-Control": "no-store" } });
}
