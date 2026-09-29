import { sql } from "drizzle-orm";
import { db } from "@/db";
import { childLogger, safePath } from "@/lib/log";

export const dynamic = "force-dynamic";

const log = childLogger("health");

export async function GET(request: Request) {
  log.debug({ path: safePath(request.url) }, "health check");
  try {
    await db.execute(sql`select 1`);
    return Response.json({ ok: true, db: true });
  } catch (err) {
    log.error({ err }, "health check: db unreachable");
    return Response.json({ ok: false, db: false }, { status: 503 });
  }
}
