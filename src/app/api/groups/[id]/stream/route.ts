import { db } from "@/db";
import { getChatHub } from "@/lib/chat/hub";
import { openGroupStream, parseLastEventId } from "@/lib/chat/stream";
import { getMemberGroup } from "@/lib/groups/queries";
import { getCurrentUser } from "@/lib/session";

// A live stream per request: never cached or prerendered.
export const dynamic = "force-dynamic";

/**
 * GET /api/groups/:id/stream: the group's live chat events (Server-Sent
 * Events; format and replay rules in src/lib/chat/stream.ts). Members only:
 * 401 without an onboarded session, 404 for non-members and unknown groups.
 * All streams in this process share one LISTEN connection (lib/chat/hub.ts).
 */
export async function GET(request: Request, ctx: RouteContext<"/api/groups/[id]/stream">) {
  const user = await getCurrentUser();
  if (!user?.onboardedAt) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!(await getMemberGroup(db, id, user.id))) return Response.json({ error: "not found" }, { status: 404 });

  const hub = await getChatHub();
  return openGroupStream(
    { groupId: id, userId: user.id, lastEventId: parseLastEventId(request), signal: request.signal },
    { db, hub },
  );
}
