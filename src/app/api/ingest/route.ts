import { handleIngest } from "@/lib/ingest/handler";

/*
 * POST /api/ingest: the iPhone Shortcut's sync endpoint (API key auth).
 * All logic lives in src/lib/ingest/handler.ts; see docs/ingest-api.md.
 * The proxy doesn't run on this path (see the matcher in src/proxy.ts), so
 * the body streams straight here instead of being buffered by the proxy.
 */

export const dynamic = "force-dynamic";

export function POST(request: Request): Promise<Response> {
  return handleIngest(request);
}

function methodNotAllowed(): Response {
  return Response.json(
    { error: "method_not_allowed" },
    { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } },
  );
}

export { methodNotAllowed as GET, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };
