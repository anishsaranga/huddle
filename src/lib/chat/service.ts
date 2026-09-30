/**
 * Group chat data layer: plain functions over a Drizzle handle (the server
 * actions and API routes pass the app's `db`; integration tests pass it too).
 *
 * Every function takes the acting user's id and checks group membership
 * itself (admins get no exemption, like the rest of the Community tab), so no
 * caller can forget. A non-member, an unknown group and a message in another
 * group all look the same: `not_found`.
 *
 * Writes announce themselves with `notifyGroup` inside the same transaction,
 * so listeners hear about a change only once it's committed. Logs carry ids
 * only, never message text.
 */

import { and, asc, desc, eq, gt, inArray, isNull, lt, sql, type SQL } from "drizzle-orm";
import { messages, reactions, users } from "@/db/schema";
import type { Db } from "@/lib/admin/db";
import { markDeletedChampions } from "@/lib/champions/deleted";
import { getMemberGroup } from "@/lib/groups/queries";
import { childLogger } from "@/lib/log";
import { SlidingWindowLimiter } from "@/lib/ratelimit";
import { isReactionEmoji } from "./emoji";
import { notifyGroup } from "./notify";
import { CHAT_PAGE_SIZE, type ChatMessage, type ChatPage, type ReactionSummary } from "./types";
import { normalizeBody, type BodyError } from "./validate";

const log = childLogger("chat");

export type ChatFailure<C extends string> = { ok: false; code: C; message: string; retryAfterSec?: number };
export type ChatResult<T, C extends string> = ({ ok: true } & T) | ChatFailure<C>;

const NOT_FOUND = { ok: false, code: "not_found", message: "That chat isn't available." } as const;

/* ------------------------------------------------------------------------ */
/* Rate limits (in memory, per process; see lib/ratelimit.ts)                */
/* ------------------------------------------------------------------------ */

export const MESSAGE_RATE_LIMIT = 20;
export const REACTION_RATE_LIMIT = 60;
const MINUTE = 60_000;

export type ChatLimiters = { messages: SlidingWindowLimiter; reactions: SlidingWindowLimiter };

const globalForChat = globalThis as unknown as { __huddleChatLimiters?: ChatLimiters };

export function getChatLimiters(): ChatLimiters {
  if (!globalForChat.__huddleChatLimiters) {
    globalForChat.__huddleChatLimiters = {
      messages: new SlidingWindowLimiter({ limit: MESSAGE_RATE_LIMIT, windowMs: MINUTE }),
      reactions: new SlidingWindowLimiter({ limit: REACTION_RATE_LIMIT, windowMs: MINUTE }),
    };
  }
  return globalForChat.__huddleChatLimiters;
}

/** Clear the chat counters (tests). */
export function resetChatLimiters(): void {
  const l = getChatLimiters();
  l.messages.reset();
  l.reactions.reset();
}

/* ------------------------------------------------------------------------ */
/* Reads                                                                     */
/* ------------------------------------------------------------------------ */

export type ListOptions = {
  /** Only messages older than this id (history paging). */
  before?: number;
  /** Only messages newer than this id (catch-up), oldest first. */
  after?: number;
  /** Exactly these ids (live refetch). At most 100. */
  ids?: number[];
  limit?: number;
};

export const MAX_PAGE = 100;

/**
 * Messages of a group as `viewerId` sees them, ascending by id, with author
 * display info and reactions aggregated per emoji (`mine` = the viewer
 * reacted). Default: the newest page. Null when the viewer isn't a member.
 */
export async function listMessages(db: Db, groupId: string, viewerId: string, opts: ListOptions = {}): Promise<ChatPage | null> {
  if (!(await getMemberGroup(db, groupId, viewerId))) return null;
  return loadMessages(db, groupId, viewerId, opts);
}

async function loadMessages(db: Db, groupId: string, viewerId: string, opts: ListOptions): Promise<ChatPage> {
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? CHAT_PAGE_SIZE), 1), MAX_PAGE);
  const where: SQL[] = [eq(messages.groupId, groupId)];
  let ascending = false;
  if (opts.ids) {
    const ids = [...new Set(opts.ids.filter((n) => Number.isSafeInteger(n) && n > 0))].slice(0, MAX_PAGE);
    if (ids.length === 0) return { messages: [], hasMore: false };
    where.push(inArray(messages.id, ids));
  } else if (opts.after !== undefined) {
    where.push(gt(messages.id, opts.after));
    ascending = true;
  } else if (opts.before !== undefined) {
    where.push(lt(messages.id, opts.before));
  }

  const rows = await db
    .select({
      id: messages.id,
      kind: messages.kind,
      body: messages.body,
      payload: messages.payload,
      createdAt: messages.createdAt,
      deletedAt: messages.deletedAt,
      authorId: users.id,
      displayName: users.displayName,
      username: users.username,
      avatarKind: users.avatarKind,
      avatarConfig: users.avatarConfig,
      avatarPath: users.avatarPath,
    })
    .from(messages)
    .leftJoin(users, eq(users.id, messages.userId))
    .where(and(...where))
    .orderBy(ascending ? asc(messages.id) : desc(messages.id))
    .limit(opts.ids ? MAX_PAGE : limit + 1);

  const hasMore = !opts.ids && !ascending && rows.length > limit;
  const page = (opts.ids ? rows : rows.slice(0, limit)).sort((a, b) => a.id - b.id);
  const reactionsById = await loadReactions(
    db,
    page.filter((r) => !r.deletedAt).map((r) => r.id),
    viewerId,
  );

  const list: ChatMessage[] = page.map((r) => ({
      id: r.id,
      kind: r.kind,
      body: r.deletedAt ? "" : r.body,
      payload: r.deletedAt ? null : (r.payload ?? null),
      createdAt: r.createdAt.toISOString(),
      deleted: !!r.deletedAt,
      author: r.authorId
        ? {
            id: r.authorId,
            displayName: r.displayName,
            username: r.username,
            avatarKind: r.avatarKind,
            avatarConfig: r.avatarConfig,
            avatarPath: r.avatarPath,
          }
        : null,
      reactions: reactionsById.get(r.id) ?? [],
  }));
  // Champions posts: flag winners whose account was deleted since (the payload keeps their ids).
  return { hasMore, messages: await markDeletedChampions(db, list) };
}

/** Reactions per message, one entry per emoji in first-reaction order. One query. */
async function loadReactions(db: Db, ids: number[], viewerId: string): Promise<Map<number, ReactionSummary[]>> {
  const out = new Map<number, ReactionSummary[]>();
  if (ids.length === 0) return out;
  const rows = await db
    .select({
      messageId: reactions.messageId,
      emoji: reactions.emoji,
      count: sql<number>`count(*)::int`,
      mine: sql<boolean>`bool_or(${reactions.userId} = ${viewerId})`,
    })
    .from(reactions)
    .where(inArray(reactions.messageId, ids))
    .groupBy(reactions.messageId, reactions.emoji)
    .orderBy(sql`min(${reactions.createdAt})`, reactions.emoji);
  for (const r of rows) {
    const list = out.get(r.messageId) ?? [];
    list.push({ emoji: r.emoji, count: r.count, mine: !!r.mine });
    out.set(r.messageId, list);
  }
  return out;
}

/** Message ids of a group newer than `afterId` (SSE replay), oldest first, at most `limit`. */
export async function messageIdsAfter(db: Db, groupId: string, afterId: number, limit: number): Promise<number[]> {
  const rows = await db
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.groupId, groupId), gt(messages.id, afterId)))
    .orderBy(asc(messages.id))
    .limit(limit);
  return rows.map((r) => r.id);
}

/* ------------------------------------------------------------------------ */
/* Writes                                                                    */
/* ------------------------------------------------------------------------ */

export type SendInput = { groupId: string; userId: string; body: unknown; limiter?: SlidingWindowLimiter; now?: number };
export type SendCode = "not_found" | BodyError | "rate_limited";

/** Post a text message (see validate.ts for the body rules). 20 per minute per user. */
export async function sendMessage(db: Db, input: SendInput): Promise<ChatResult<{ message: ChatMessage }, SendCode>> {
  const { groupId, userId } = input;
  if (!(await getMemberGroup(db, groupId, userId))) return NOT_FOUND;

  const body = normalizeBody(input.body);
  if (!body.ok) return { ok: false, code: body.code, message: body.message };

  const limit = (input.limiter ?? getChatLimiters().messages).hit(userId, input.now);
  if (!limit.ok) {
    log.info({ groupId, userId, retryAfterSec: limit.retryAfterSec }, "message rate limited");
    return {
      ok: false,
      code: "rate_limited",
      message: "You're sending messages too fast. Take a breather.",
      retryAfterSec: limit.retryAfterSec,
    };
  }

  const id = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(messages)
      .values({ groupId, userId, kind: "text", body: body.body })
      .returning({ id: messages.id });
    await notifyGroup(tx, groupId, { type: "message", id: row.id });
    return row.id;
  });
  log.info({ groupId, userId, messageId: id }, "message sent");

  const { messages: [message] } = await loadMessages(db, groupId, userId, { ids: [id] });
  return { ok: true, message };
}

export type ReactInput = { groupId: string; userId: string; messageId: number; emoji: unknown; limiter?: SlidingWindowLimiter };
export type ReactCode = "not_found" | "invalid_emoji" | "rate_limited";

/**
 * Add the viewer's `emoji` reaction to a message, or remove it if it's
 * there. Returns whether it's now on and the message's updated reactions.
 */
export async function toggleReaction(
  db: Db,
  input: ReactInput,
): Promise<ChatResult<{ active: boolean; reactions: ReactionSummary[] }, ReactCode>> {
  const { groupId, userId, messageId, emoji } = input;
  if (!isReactionEmoji(emoji)) return { ok: false, code: "invalid_emoji", message: "That reaction isn't available." };
  if (!Number.isSafeInteger(messageId) || messageId <= 0) return NOT_FOUND;
  if (!(await getMemberGroup(db, groupId, userId))) return NOT_FOUND;

  const [target] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.id, messageId), eq(messages.groupId, groupId), isNull(messages.deletedAt)))
    .limit(1);
  if (!target) return NOT_FOUND;

  const limit = (input.limiter ?? getChatLimiters().reactions).hit(userId);
  if (!limit.ok) {
    return { ok: false, code: "rate_limited", message: "Easy there. Try again in a moment.", retryAfterSec: limit.retryAfterSec };
  }

  const active = await db.transaction(async (tx) => {
    const removed = await tx
      .delete(reactions)
      .where(and(eq(reactions.messageId, messageId), eq(reactions.userId, userId), eq(reactions.emoji, emoji)))
      .returning({ emoji: reactions.emoji });
    if (removed.length === 0) {
      await tx.insert(reactions).values({ messageId, userId, emoji }).onConflictDoNothing();
    }
    await notifyGroup(tx, groupId, { type: "reaction", id: messageId });
    return removed.length === 0;
  });
  log.info({ groupId, userId, messageId, active }, "reaction toggled");

  const summary = await loadReactions(db, [messageId], userId);
  return { ok: true, active, reactions: summary.get(messageId) ?? [] };
}

export type DeleteInput = { groupId: string; userId: string; messageId: number };
export type DeleteCode = "not_found" | "forbidden";

/**
 * Soft-delete one of your own text messages: the body is cleared, reactions
 * are removed and `deleted_at` is set (the row keeps its id and place, and
 * shows as "Message deleted"). Deleting twice is fine.
 */
export async function deleteMessage(db: Db, input: DeleteInput): Promise<ChatResult<object, DeleteCode>> {
  const { groupId, userId, messageId } = input;
  if (!Number.isSafeInteger(messageId) || messageId <= 0) return NOT_FOUND;
  if (!(await getMemberGroup(db, groupId, userId))) return NOT_FOUND;

  const [target] = await db
    .select({ userId: messages.userId, kind: messages.kind, deletedAt: messages.deletedAt })
    .from(messages)
    .where(and(eq(messages.id, messageId), eq(messages.groupId, groupId)))
    .limit(1);
  if (!target) return NOT_FOUND;
  if (target.userId !== userId || target.kind !== "text") {
    return { ok: false, code: "forbidden", message: "You can only delete your own messages." };
  }
  if (target.deletedAt) return { ok: true };

  await db.transaction(async (tx) => {
    await tx
      .update(messages)
      .set({ body: "", payload: null, deletedAt: new Date() })
      .where(and(eq(messages.id, messageId), isNull(messages.deletedAt)));
    await tx.delete(reactions).where(eq(reactions.messageId, messageId));
    await notifyGroup(tx, groupId, { type: "delete", id: messageId });
  });
  log.info({ groupId, userId, messageId }, "message deleted");
  return { ok: true };
}
