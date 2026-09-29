import { db } from "@/db";
import { checkUsername } from "@/lib/profile/service";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * GET /api/me/username?u=<candidate>: is this username valid and free?
 * Keeping your own current username counts as available. Session required.
 * (The unique index is still the source of truth when saving.)
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const candidate = new URL(request.url).searchParams.get("u") ?? "";
  const result = await checkUsername(db, candidate, user.id);
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
