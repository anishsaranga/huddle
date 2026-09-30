import { createExportStream, exportFilename, getExportLimiter } from "@/lib/account/export";
import { childLogger } from "@/lib/log";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";
// postgres.js and the Node streams need the Node runtime.
export const runtime = "nodejs";

const log = childLogger("export");

/**
 * GET /api/me/export: everything Huddle stores about the signed-in user as one downloadable JSON file,
 * streamed section by section (see src/lib/account/export.ts). Session auth only (never an API key),
 * 5 per hour per user. The Profile row is a plain link to this route: a navigation that answers with
 * `Content-Disposition: attachment` makes iOS Safari (and the standalone PWA) show its download sheet.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });

  const limit = getExportLimiter().hit(user.id);
  if (!limit.ok) {
    log.info({ userId: user.id }, "export rate limited");
    // A link tap (a navigation) would show raw JSON, so send those back to Profile with a notice.
    if ((request.headers.get("accept") ?? "").includes("text/html")) {
      return new Response(null, {
        status: 303,
        headers: { Location: "/profile?export=limited", "Cache-Control": "no-store", "Retry-After": String(limit.retryAfterSec) },
      });
    }
    return Response.json(
      { error: "rate_limited", message: "You can export up to 5 times an hour. Try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec), "Cache-Control": "no-store" } },
    );
  }

  const now = new Date();
  log.info({ userId: user.id }, "export started");
  return new Response(createExportStream(user.id, { now }), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportFilename(user, now)}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
