/**
 * Group fan-out over Postgres NOTIFY.
 *
 * Every change to a group's chat is announced on the channel
 * `group_<uuid without dashes>` (a valid unquoted identifier, 38 chars) with a
 * tiny JSON payload, `{ "type": "message" | "reaction" | "delete", "id": <message id> }`.
 * Subscribers (the SSE route through `hub.ts`) forward it to browsers, which
 * refetch the message itself, so payloads never carry text or per-viewer data
 * and stay far below NOTIFY's 8000-byte limit.
 *
 * Reuse: anything that posts into a group (e.g. the weekly champions job
 * inserting a `champions` message) calls `notifyGroup(db, groupId, { type:
 * "message", id })` after the insert. Called inside a transaction, the
 * notification is delivered only if and when it commits, so listeners never
 * see an id they can't read yet; outside one it's sent immediately.
 *
 * Accepts either a postgres.js client (`sql` from "@/db", or a `sql.begin`
 * transaction) or a Drizzle handle (`db`, or a `db.transaction` tx).
 */

import { sql as dsql } from "drizzle-orm";
import type postgres from "postgres";
import type { GroupEvent } from "./types";

/** Anything we can run `select pg_notify(…)` on. */
export type NotifyExecutor =
  | postgres.Sql
  | postgres.TransactionSql
  | { execute: (query: ReturnType<typeof dsql>) => PromiseLike<unknown> };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PAYLOAD_BYTES = 7900;

/** `group_<32 hex>`: the NOTIFY channel for a group. Throws on a non-UUID. */
export function groupChannel(groupId: string): string {
  if (!UUID_RE.test(groupId)) throw new Error("groupChannel: not a uuid");
  return `group_${groupId.replace(/-/g, "").toLowerCase()}`;
}

/** Serialize an event for NOTIFY (throws if it would exceed the payload limit). */
export function encodeGroupEvent(event: GroupEvent | (GroupEvent & Record<string, unknown>)): string {
  const json = JSON.stringify(event);
  if (Buffer.byteLength(json, "utf8") > MAX_PAYLOAD_BYTES) throw new Error("notifyGroup: payload too large");
  return json;
}

export async function notifyGroup(executor: NotifyExecutor, groupId: string, event: GroupEvent): Promise<void> {
  const channel = groupChannel(groupId);
  const payload = encodeGroupEvent(event);
  if (typeof executor === "function") {
    // postgres.js tagged template (client or transaction).
    await (executor as postgres.Sql)`select pg_notify(${channel}, ${payload})`;
  } else {
    await executor.execute(dsql`select pg_notify(${channel}, ${payload})`);
  }
}
