"use server";

import { z } from "zod";
import { db } from "@/db";
import type { ActionResult } from "@/lib/admin/db";
import {
  getIngestEventBody,
  getIngestEventDetail,
  type IngestEventBody,
  type IngestEventDetail,
} from "@/lib/admin/data";
import { childLogger } from "@/lib/log";
import { requireAdmin } from "@/lib/session";

/*
 * Lazy loaders for the ingest log's expanded rows. Server actions are plain
 * POST endpoints, so each one re-checks the admin itself (requireAdmin()
 * 404s everyone else, before any query runs).
 */

const log = childLogger("admin");

const eventId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

/** Per-day field inventory of one ingest event. */
export async function getIngestEventDetailAction(id: number): Promise<ActionResult<{ detail: IngestEventDetail }>> {
  const admin = await requireAdmin();
  const parsed = eventId.safeParse(id);
  if (!parsed.success) return { ok: false, error: "Unknown event." };
  try {
    const detail = await getIngestEventDetail(db, parsed.data);
    if (!detail) return { ok: false, error: "That event no longer exists." };
    return { ok: true, detail };
  } catch (err) {
    log.error({ actorId: admin.id, action: "ingest.detail", eventId: parsed.data, err: String(err) }, "admin action failed");
    return { ok: false, error: "Couldn't load that event. Try again." };
  }
}

/** Raw request body of one ingest event (at most 200 KB of it). */
export async function getIngestEventBodyAction(id: number): Promise<ActionResult<{ body: IngestEventBody }>> {
  const admin = await requireAdmin();
  const parsed = eventId.safeParse(id);
  if (!parsed.success) return { ok: false, error: "Unknown event." };
  try {
    const body = await getIngestEventBody(db, parsed.data);
    if (!body) return { ok: false, error: "That event no longer exists." };
    return { ok: true, body };
  } catch (err) {
    log.error({ actorId: admin.id, action: "ingest.body", eventId: parsed.data, err: String(err) }, "admin action failed");
    return { ok: false, error: "Couldn't load the body. Try again." };
  }
}
