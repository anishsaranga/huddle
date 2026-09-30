import { inArray } from "drizzle-orm";
import { users } from "@/db/schema";
import type { Db } from "@/lib/admin/db";
import { payloadUserIds } from "./types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * For champions messages: which of the users their payload mentions no
 * longer exist (deleted accounts), added as `payload.deletedUserIds` (never
 * stored). One query for any number of messages; other messages pass through
 * untouched.
 */
export async function markDeletedChampions<M extends { kind: string; payload: Record<string, unknown> | null }>(
  db: Pick<Db, "select">,
  list: M[],
): Promise<M[]> {
  const ids = new Set<string>();
  for (const m of list) if (m.kind === "champions") for (const id of payloadUserIds(m.payload)) ids.add(id);
  if (ids.size === 0) return list;
  const valid = [...ids].filter((id) => UUID_RE.test(id));
  const found = valid.length
    ? new Set((await db.select({ id: users.id }).from(users).where(inArray(users.id, valid))).map((r) => r.id))
    : new Set<string>();
  const missing = new Set([...ids].filter((id) => !found.has(id)));
  if (missing.size === 0) return list;
  return list.map((m) => {
    if (m.kind !== "champions" || !m.payload) return m;
    const gone = payloadUserIds(m.payload).filter((id) => missing.has(id));
    return gone.length ? { ...m, payload: { ...m.payload, deletedUserIds: gone } } : m;
  });
}
