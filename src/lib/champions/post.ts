/**
 * Posting a group's weekly champions into its chat (idempotent).
 *
 * `postWeeklyChampions(db, groupId, weekStart)`:
 * 1. Already posted for that group and week (an award row or a champions
 *    message with that `weekStart`) → nothing happens.
 * 2. Compute the facts (compute.ts); fewer than 2 qualifying members → skipped.
 * 3. Generate the text (Gemini or the template), outside any transaction.
 * 4. One transaction, serialized per (group, week) by an advisory lock: check
 *    again, insert the `champions` message (user_id null), insert one
 *    `champion_awards` row per category pointing at it (ON CONFLICT DO
 *    NOTHING on (group_id, week_start, category); if none went in, roll back),
 *    then `notifyGroup` (delivered on commit).
 *
 * The payload keeps user ids and a snapshot of names/avatars. Deleting an
 * account removes its award rows (cascade) but not the post; the chat marks
 * such users as deleted when it reads the message (`markDeletedChampions` in deleted.ts).
 */

import { and, eq, sql } from "drizzle-orm";
import type { Logger } from "pino";
import { championAwards, messages } from "@/db/schema";
import type { Db } from "@/lib/admin/db";
import { notifyGroup } from "@/lib/chat/notify";
import { childLogger } from "@/lib/log";
import { getChampionGroup, isMonday, loadChampionFacts } from "./compute";
import { createChampionsGenerator, type ChampionsGenerator, type ChampionsText } from "./generate";
import type { ChampionFacts, ChampionsPayload } from "./types";

export type PostOptions = {
  now?: Date;
  /** Text generator (default: Gemini with the template fallback). */
  generate?: ChampionsGenerator;
  log?: Logger;
};

export type PostResult =
  | { status: "posted"; messageId: number; weekStart: string; source: ChampionsText["source"]; awards: number }
  | { status: "already_posted"; weekStart: string; messageId: number | null }
  | { status: "skipped"; weekStart: string; reason: "not_enough_data" | "no_group" };

/** The existing post for a group's week, if any (award rows or the message itself). */
export async function findChampionsPost(
  db: Pick<Db, "select">,
  groupId: string,
  weekStart: string,
): Promise<{ messageId: number | null } | null> {
  const [award] = await db
    .select({ messageId: championAwards.messageId })
    .from(championAwards)
    .where(and(eq(championAwards.groupId, groupId), eq(championAwards.weekStart, weekStart)))
    .limit(1);
  if (award) return { messageId: award.messageId };
  const [msg] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.groupId, groupId), eq(messages.kind, "champions"), sql`${messages.payload}->>'weekStart' = ${weekStart}`))
    .limit(1);
  return msg ? { messageId: msg.id } : null;
}

/** The stored payload for computed facts and the text's source. */
export function buildPayload(facts: ChampionFacts, source: ChampionsText["source"]): ChampionsPayload {
  return { v: 1, weekStart: facts.weekStart, weekLabel: facts.weekLabel, categories: facts.categories, source };
}

class AlreadyPosted extends Error {
  constructor(readonly messageId: number | null) {
    super("already posted");
  }
}

export async function postWeeklyChampions(db: Db, groupId: string, weekStart: string, opts: PostOptions = {}): Promise<PostResult> {
  const log = opts.log ?? childLogger("champions");
  if (!isMonday(weekStart)) throw new Error("postWeeklyChampions: weekStart must be a Monday (YYYY-MM-DD)");
  const group = await getChampionGroup(db, groupId);
  if (!group) return { status: "skipped", weekStart, reason: "no_group" };

  const existing = await findChampionsPost(db, groupId, weekStart);
  if (existing) return { status: "already_posted", weekStart, messageId: existing.messageId };

  const facts = await loadChampionFacts(db, group, weekStart);
  if (!facts || facts.categories.length === 0) {
    log.debug({ groupId, weekStart }, "champions skipped: fewer than 2 members with enough data");
    return { status: "skipped", weekStart, reason: "not_enough_data" };
  }

  const generate = opts.generate ?? createChampionsGenerator({ log: log.child({ module: "ai" }) });
  const { text, source } = await generate(facts);
  const payload = buildPayload(facts, source);

  try {
    const posted = await db.transaction(async (tx) => {
      // Two posters for the same group and week (worker + admin) queue up here.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`champions:${groupId}:${weekStart}`}))`);
      const again = await findChampionsPost(tx, groupId, weekStart);
      if (again) throw new AlreadyPosted(again.messageId);

      const [msg] = await tx
        .insert(messages)
        .values({
          groupId,
          userId: null,
          kind: "champions",
          body: text,
          payload: payload as unknown as Record<string, unknown>,
          ...(opts.now ? { createdAt: opts.now } : {}),
        })
        .returning({ id: messages.id });
      const messageId = Number(msg.id);

      const inserted = await tx
        .insert(championAwards)
        .values(
          facts.categories.map((c) => ({
            groupId,
            weekStart,
            category: c.category,
            userId: c.winners[0].userId,
            value: c.winners[0].value,
            messageId,
          })),
        )
        .onConflictDoNothing({ target: [championAwards.groupId, championAwards.weekStart, championAwards.category] })
        .returning({ id: championAwards.id });
      if (inserted.length === 0) throw new AlreadyPosted(null);

      await notifyGroup(tx, groupId, { type: "message", id: messageId });
      return { messageId, awards: inserted.length };
    });
    log.info({ groupId, weekStart, messageId: posted.messageId, awards: posted.awards, source }, "weekly champions posted");
    return { status: "posted", weekStart, source, ...posted };
  } catch (err) {
    if (err instanceof AlreadyPosted) return { status: "already_posted", weekStart, messageId: err.messageId };
    throw err;
  }
}
