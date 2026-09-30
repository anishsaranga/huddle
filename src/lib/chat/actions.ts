"use server";

import { db } from "@/db";
import { childLogger } from "@/lib/log";
import { requireOnboardedUser } from "@/lib/session";
import { deleteMessage, sendMessage, toggleReaction } from "./service";
import type { ChatMessage, ReactionSummary } from "./types";

/*
 * Chat mutations. Server actions are plain POST endpoints (with Next's
 * same-origin check), so each re-checks the session; the service functions
 * check group membership and validate input. Logs carry ids only.
 */

const log = childLogger("chat");
const GENERIC_ERROR = "Something went wrong. Try again.";

export type ChatActionFailure = { ok: false; code: string; error: string; retryAfterSec?: number };

function failure(err: unknown, where: string, ids: Record<string, unknown>): ChatActionFailure {
  log.error({ ...ids, err: err instanceof Error ? err.message : String(err) }, `${where} failed`);
  return { ok: false, code: "error", error: GENERIC_ERROR };
}

export async function sendMessageAction(
  groupId: string,
  body: string,
): Promise<{ ok: true; message: ChatMessage } | ChatActionFailure> {
  const user = await requireOnboardedUser();
  try {
    const r = await sendMessage(db, { groupId, userId: user.id, body });
    if (!r.ok) return { ok: false, code: r.code, error: r.message, retryAfterSec: r.retryAfterSec };
    return { ok: true, message: r.message };
  } catch (err) {
    return failure(err, "send", { groupId, userId: user.id });
  }
}

export async function toggleReactionAction(
  groupId: string,
  messageId: number,
  emoji: string,
): Promise<{ ok: true; active: boolean; reactions: ReactionSummary[] } | ChatActionFailure> {
  const user = await requireOnboardedUser();
  try {
    const r = await toggleReaction(db, { groupId, userId: user.id, messageId, emoji });
    if (!r.ok) return { ok: false, code: r.code, error: r.message, retryAfterSec: r.retryAfterSec };
    return { ok: true, active: r.active, reactions: r.reactions };
  } catch (err) {
    return failure(err, "reaction", { groupId, userId: user.id, messageId });
  }
}

export async function deleteMessageAction(groupId: string, messageId: number): Promise<{ ok: true } | ChatActionFailure> {
  const user = await requireOnboardedUser();
  try {
    const r = await deleteMessage(db, { groupId, userId: user.id, messageId });
    if (!r.ok) return { ok: false, code: r.code, error: r.message };
    return { ok: true };
  } catch (err) {
    return failure(err, "delete", { groupId, userId: user.id, messageId });
  }
}
