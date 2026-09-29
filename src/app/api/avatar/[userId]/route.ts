import { z } from "zod";
import { avatarResponse, getAvatarOwner } from "@/lib/avatar/serve";
import { childLogger, safePath } from "@/lib/log";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

const log = childLogger("avatar");
const UserId = z.uuid();

/**
 * GET /api/avatar/:userId[?format=svg|png][&size=16..1024][&v=…]
 * Any signed-in user may fetch any active user's avatar (friends see each
 * other in groups). DiceBear avatars render locally; uploads stream from
 * AVATAR_DIR.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/avatar/[userId]">) {
  const viewer = await getCurrentUser();
  if (!viewer) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { userId } = await ctx.params;
  if (!UserId.safeParse(userId).success) return Response.json({ error: "not found" }, { status: 404 });

  const owner = await getAvatarOwner(userId);
  if (!owner) return Response.json({ error: "not found" }, { status: 404 });

  try {
    return await avatarResponse(owner, request);
  } catch (err) {
    log.error({ err, path: safePath(request.url) }, "avatar render failed");
    return Response.json({ error: "avatar unavailable" }, { status: 500 });
  }
}
