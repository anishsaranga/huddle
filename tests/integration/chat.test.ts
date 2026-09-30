import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, sql } from "@/db";
import { groupMembers, groups, messages, reactions, users } from "@/db/schema";
import { SlidingWindowLimiter } from "@/lib/ratelimit";

// Routes read the session through getCurrentUser(); stub it per test.
const session = vi.hoisted(() => ({ user: null as null | { id: string; onboardedAt: Date | null } }));
vi.mock("@/lib/session", () => ({ getCurrentUser: async () => session.user }));

const { deleteMessage, listMessages, resetChatLimiters, sendMessage, toggleReaction, MESSAGE_RATE_LIMIT } = await import("@/lib/chat/service");
const { groupChannel, notifyGroup } = await import("@/lib/chat/notify");
const { getChatHub } = await import("@/lib/chat/hub");
const { GET: streamGET } = await import("@/app/api/groups/[id]/stream/route");
const { GET: messagesGET } = await import("@/app/api/groups/[id]/messages/route");

async function person(name: string) {
  const [u] = await db
    .insert(users)
    .values({ email: `${name}@example.com`, username: name, displayName: name[0].toUpperCase() + name.slice(1), onboardedAt: new Date() })
    .returning();
  return u;
}

async function setup() {
  const ann = await person("ann");
  const ben = await person("ben");
  const zed = await person("zed"); // not a member
  const [g] = await db.insert(groups).values({ name: "Crew" }).returning();
  await db.insert(groupMembers).values([
    { groupId: g.id, userId: ann.id },
    { groupId: g.id, userId: ben.id },
  ]);
  return { ann, ben, zed, groupId: g.id };
}

beforeEach(() => {
  resetChatLimiters();
  session.user = null;
});

describe("chat service", () => {
  it("sends, lists with author info, and enforces membership everywhere", async () => {
    const { ann, ben, zed, groupId } = await setup();
    const sent = await sendMessage(db, { groupId, userId: ann.id, body: "  Morning!\n\n\n\n\n\nLong run?  " });
    expect(sent).toMatchObject({ ok: true, message: { kind: "text", body: "Morning!\n\n\n\nLong run?", deleted: false, reactions: [] } });
    if (!sent.ok) throw new Error();
    expect(sent.message.author).toMatchObject({ id: ann.id, displayName: "Ann", username: "ann" });

    const page = await listMessages(db, groupId, ben.id);
    expect(page?.messages.map((m) => m.body)).toEqual(["Morning!\n\n\n\nLong run?"]);
    expect(page?.hasMore).toBe(false);

    // Outsiders: every entry point says not_found / null.
    expect(await listMessages(db, groupId, zed.id)).toBeNull();
    expect(await sendMessage(db, { groupId, userId: zed.id, body: "hi" })).toMatchObject({ ok: false, code: "not_found" });
    expect(await toggleReaction(db, { groupId, userId: zed.id, messageId: sent.message.id, emoji: "🔥" })).toMatchObject({ ok: false, code: "not_found" });
    expect(await deleteMessage(db, { groupId, userId: zed.id, messageId: sent.message.id })).toMatchObject({ ok: false, code: "not_found" });
    expect(await listMessages(db, "not-a-uuid", ann.id)).toBeNull();

    // Invalid bodies.
    expect(await sendMessage(db, { groupId, userId: ann.id, body: "   " })).toMatchObject({ ok: false, code: "empty" });
    expect(await sendMessage(db, { groupId, userId: ann.id, body: "x".repeat(1001) })).toMatchObject({ ok: false, code: "too_long" });
    expect(await sendMessage(db, { groupId, userId: ann.id, body: "a\u0000b" })).toMatchObject({ ok: false, code: "invalid_chars" });
    expect(await sendMessage(db, { groupId, userId: ann.id, body: { evil: true } })).toMatchObject({ ok: false, code: "empty" });
  });

  it("pages history with before/after/ids", async () => {
    const { ann, groupId } = await setup();
    const ids: number[] = [];
    for (let i = 1; i <= 7; i++) {
      const r = await sendMessage(db, { groupId, userId: ann.id, body: `m${i}` });
      if (r.ok) ids.push(r.message.id);
    }
    const newest = await listMessages(db, groupId, ann.id, { limit: 3 });
    expect(newest?.messages.map((m) => m.body)).toEqual(["m5", "m6", "m7"]);
    expect(newest?.hasMore).toBe(true);
    const older = await listMessages(db, groupId, ann.id, { before: ids[4], limit: 3 });
    expect(older?.messages.map((m) => m.body)).toEqual(["m2", "m3", "m4"]);
    expect(older?.hasMore).toBe(true);
    const oldest = await listMessages(db, groupId, ann.id, { before: ids[1], limit: 3 });
    expect(oldest?.messages.map((m) => m.body)).toEqual(["m1"]);
    expect(oldest?.hasMore).toBe(false);
    const after = await listMessages(db, groupId, ann.id, { after: ids[4] });
    expect(after?.messages.map((m) => m.body)).toEqual(["m6", "m7"]);
    const some = await listMessages(db, groupId, ann.id, { ids: [ids[6], ids[0], 999999] });
    expect(some?.messages.map((m) => m.body)).toEqual(["m1", "m7"]);
  });

  it("does not leak messages from other groups through ids/after", async () => {
    const { ann, groupId } = await setup();
    const [other] = await db.insert(groups).values({ name: "Other" }).returning();
    await db.insert(groupMembers).values({ groupId: other.id, userId: ann.id });
    const r = await sendMessage(db, { groupId: other.id, userId: ann.id, body: "secret" });
    if (!r.ok) throw new Error();
    expect((await listMessages(db, groupId, ann.id, { ids: [r.message.id] }))?.messages).toEqual([]);
    expect(await toggleReaction(db, { groupId, userId: ann.id, messageId: r.message.id, emoji: "🔥" })).toMatchObject({ code: "not_found" });
    expect(await deleteMessage(db, { groupId, userId: ann.id, messageId: r.message.id })).toMatchObject({ code: "not_found" });
  });

  it("toggles curated reactions and aggregates them per emoji with a mine flag", async () => {
    const { ann, ben, groupId } = await setup();
    const sent = await sendMessage(db, { groupId, userId: ann.id, body: "PR today" });
    if (!sent.ok) throw new Error();
    const id = sent.message.id;

    expect(await toggleReaction(db, { groupId, userId: ben.id, messageId: id, emoji: "🍕" })).toMatchObject({ ok: false, code: "invalid_emoji" });
    expect(await toggleReaction(db, { groupId, userId: ben.id, messageId: id, emoji: "🔥" })).toMatchObject({
      ok: true,
      active: true,
      reactions: [{ emoji: "🔥", count: 1, mine: true }],
    });
    await toggleReaction(db, { groupId, userId: ann.id, messageId: id, emoji: "🔥" });
    await toggleReaction(db, { groupId, userId: ann.id, messageId: id, emoji: "💪" });

    const asBen = await listMessages(db, groupId, ben.id);
    expect(asBen?.messages[0].reactions).toEqual([
      { emoji: "🔥", count: 2, mine: true },
      { emoji: "💪", count: 1, mine: false },
    ]);
    // Toggling again removes it.
    expect(await toggleReaction(db, { groupId, userId: ben.id, messageId: id, emoji: "🔥" })).toMatchObject({
      ok: true,
      active: false,
      reactions: [
        { emoji: "🔥", count: 1, mine: false },
        { emoji: "💪", count: 1, mine: false },
      ],
    });
  });

  it("soft-deletes own messages only; the row stays as 'deleted' without body or reactions", async () => {
    const { ann, ben, groupId } = await setup();
    const sent = await sendMessage(db, { groupId, userId: ann.id, body: "oops" });
    if (!sent.ok) throw new Error();
    const id = sent.message.id;
    await toggleReaction(db, { groupId, userId: ben.id, messageId: id, emoji: "😂" });

    expect(await deleteMessage(db, { groupId, userId: ben.id, messageId: id })).toMatchObject({ ok: false, code: "forbidden" });
    expect(await deleteMessage(db, { groupId, userId: ann.id, messageId: id })).toEqual({ ok: true });
    expect(await deleteMessage(db, { groupId, userId: ann.id, messageId: id })).toEqual({ ok: true }); // idempotent

    const [row] = await db.select().from(messages).where(eq(messages.id, id));
    expect(row.body).toBe("");
    expect(row.deletedAt).not.toBeNull();
    expect(await db.select().from(reactions)).toHaveLength(0);
    const page = await listMessages(db, groupId, ben.id);
    expect(page?.messages[0]).toMatchObject({ id, deleted: true, body: "", reactions: [] });
    // Can't react to a deleted message.
    expect(await toggleReaction(db, { groupId, userId: ben.id, messageId: id, emoji: "🔥" })).toMatchObject({ code: "not_found" });
  });

  it("shows messages of deleted accounts with a null author", async () => {
    const { ann, ben, groupId } = await setup();
    await sendMessage(db, { groupId, userId: ben.id, body: "bye" });
    await db.delete(users).where(eq(users.id, ben.id));
    const page = await listMessages(db, groupId, ann.id);
    expect(page?.messages[0]).toMatchObject({ body: "bye", author: null });
  });

  it("rate-limits sends to 20 a minute per user", async () => {
    const { ann, ben, groupId } = await setup();
    const limiter = new SlidingWindowLimiter({ limit: MESSAGE_RATE_LIMIT, windowMs: 60_000 });
    const t0 = Date.now();
    for (let i = 0; i < MESSAGE_RATE_LIMIT; i++) {
      expect((await sendMessage(db, { groupId, userId: ann.id, body: `m${i}`, limiter, now: t0 + i })).ok).toBe(true);
    }
    const blocked = await sendMessage(db, { groupId, userId: ann.id, body: "one more", limiter, now: t0 + 30_000 });
    expect(blocked).toMatchObject({ ok: false, code: "rate_limited" });
    expect(blocked.ok ? 0 : blocked.retryAfterSec).toBeGreaterThan(0);
    // Other users aren't affected; the window slides.
    expect((await sendMessage(db, { groupId, userId: ben.id, body: "hi", limiter, now: t0 + 30_000 })).ok).toBe(true);
    expect((await sendMessage(db, { groupId, userId: ann.id, body: "later", limiter, now: t0 + 60_001 })).ok).toBe(true);
  });
});

describe("notifyGroup", () => {
  it("uses the group_<hex> channel and a tiny JSON payload, delivered on commit", async () => {
    const { ann, groupId } = await setup();
    const channel = groupChannel(groupId);
    expect(channel).toBe(`group_${groupId.replace(/-/g, "")}`);
    expect(() => groupChannel("nope")).toThrow();

    const got: string[] = [];
    const listener = await sql.listen(channel, (p) => got.push(p));
    try {
      await notifyGroup(sql, groupId, { type: "message", id: 7 });
      await notifyGroup(db, groupId, { type: "delete", id: 8 });
      const sent = await sendMessage(db, { groupId, userId: ann.id, body: "hello there" });
      if (!sent.ok) throw new Error();
      await toggleReaction(db, { groupId, userId: ann.id, messageId: sent.message.id, emoji: "🔥" });
      await deleteMessage(db, { groupId, userId: ann.id, messageId: sent.message.id });
      // A rolled-back transaction announces nothing.
      await db
        .transaction(async (tx) => {
          await notifyGroup(tx, groupId, { type: "message", id: 999 });
          throw new Error("rollback");
        })
        .catch(() => {});
      await vi.waitFor(() => expect(got).toHaveLength(5));
      expect(got.map((p) => JSON.parse(p))).toEqual([
        { type: "message", id: 7 },
        { type: "delete", id: 8 },
        { type: "message", id: sent.message.id },
        { type: "reaction", id: sent.message.id },
        { type: "delete", id: sent.message.id },
      ]);
      // Never the text.
      expect(got.join("")).not.toContain("hello");
    } finally {
      await listener.unlisten();
    }
  });
});

/* ------------------------------------------------------------------------ */
/* Routes                                                                    */
/* ------------------------------------------------------------------------ */

async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, done: (text: string) => boolean, timeoutMs = 5000) {
  const decoder = new TextDecoder();
  let text = "";
  const deadline = Date.now() + timeoutMs;
  while (!done(text)) {
    if (Date.now() > deadline) throw new Error(`stream timeout; got: ${text}`);
    const chunk = await Promise.race([
      reader.read(),
      new Promise<{ done: true; value: undefined }>((r) => setTimeout(() => r({ done: true, value: undefined }), deadline - Date.now())),
    ]);
    if (chunk.done) break;
    text += decoder.decode(chunk.value, { stream: true });
  }
  return text;
}

function openStream(groupId: string, headers: Record<string, string> = {}, query = "") {
  const ctrl = new AbortController();
  const res = streamGET(new Request(`http://localhost/api/groups/${groupId}/stream${query}`, { headers, signal: ctrl.signal }), {
    params: Promise.resolve({ id: groupId }),
  });
  return { res, ctrl };
}

describe("GET /api/groups/[id]/stream", () => {
  it("401 without a session, 404 for non-members and unknown groups", async () => {
    const { zed, groupId } = await setup();
    expect((await openStream(groupId).res).status).toBe(401);
    session.user = zed;
    expect((await openStream(groupId).res).status).toBe(404);
    expect((await openStream("00000000-0000-4000-8000-000000000000").res).status).toBe(404);
    expect((await openStream("junk").res).status).toBe(404);
  });

  it("replays messages after Last-Event-ID, then streams live events; cleans up on abort", async () => {
    const { ann, ben, groupId } = await setup();
    const ids: number[] = [];
    for (const body of ["one", "two", "three"]) {
      const r = await sendMessage(db, { groupId, userId: ann.id, body });
      if (r.ok) ids.push(r.message.id);
    }
    session.user = ben;
    const { res, ctrl } = openStream(groupId, { "Last-Event-ID": String(ids[0]) });
    const response = await res;
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/^text\/event-stream/);
    expect(response.headers.get("cache-control")).toMatch(/no-transform/);

    const reader = response.body!.getReader();
    let text = await readUntil(reader, (t) => t.includes("event: ready"));
    expect(text.startsWith("retry: 3000\n\n")).toBe(true);
    // Only the messages after Last-Event-ID, as SSE ids.
    expect(text).not.toContain(`id: ${ids[0]}\n`);
    expect(text).toContain(`id: ${ids[1]}\nevent: message\ndata: {"type":"message","id":${ids[1]}}\n\n`);
    expect(text).toContain(`id: ${ids[2]}\n`);
    expect(text.indexOf(`id: ${ids[2]}`)).toBeLessThan(text.indexOf("event: ready"));

    const hub = await getChatHub();
    expect(hub.subscriberCount(groupId)).toBe(1);

    // Live: a new message and a reaction arrive through LISTEN/NOTIFY.
    const live = await sendMessage(db, { groupId, userId: ann.id, body: "four" });
    if (!live.ok) throw new Error();
    await toggleReaction(db, { groupId, userId: ann.id, messageId: ids[1], emoji: "🔥" });
    text = await readUntil(reader, (t) => t.includes("event: reaction"));
    expect(text).toContain(`id: ${live.message.id}\nevent: message\n`);
    expect(text).toContain(`event: reaction\ndata: {"type":"reaction","id":${ids[1]}}\n\n`);
    expect(text).not.toContain("four"); // ids only

    ctrl.abort();
    await vi.waitFor(() => expect(hub.subscriberCount(groupId)).toBe(0));
    await reader.cancel().catch(() => {});
  });

  it("?after= works too, and without either there's no replay", async () => {
    const { ann, groupId } = await setup();
    const r = await sendMessage(db, { groupId, userId: ann.id, body: "x" });
    if (!r.ok) throw new Error();
    session.user = ann;

    const a = openStream(groupId, {}, `?after=${r.message.id - 1}`);
    const readerA = (await a.res).body!.getReader();
    expect(await readUntil(readerA, (t) => t.includes("event: ready"))).toContain(`id: ${r.message.id}\n`);
    a.ctrl.abort();

    const b = openStream(groupId);
    const readerB = (await b.res).body!.getReader();
    const textB = await readUntil(readerB, (t) => t.includes("event: ready"));
    expect(textB).not.toContain("event: message");
    b.ctrl.abort();
    await readerA.cancel().catch(() => {});
    await readerB.cancel().catch(() => {});
  });
});

describe("GET /api/groups/[id]/messages", () => {
  const get = (groupId: string, query = "") =>
    messagesGET(new Request(`http://localhost/api/groups/${groupId}/messages${query}`), { params: Promise.resolve({ id: groupId }) });

  it("returns pages to members only and validates parameters", async () => {
    const { ann, zed, groupId } = await setup();
    const r = await sendMessage(db, { groupId, userId: ann.id, body: "<script>alert(1)</script>" });
    if (!r.ok) throw new Error();

    expect((await get(groupId)).status).toBe(401);
    session.user = { ...zed, onboardedAt: null };
    expect((await get(groupId)).status).toBe(401);
    session.user = zed;
    expect((await get(groupId)).status).toBe(404);

    session.user = ann;
    const res = await get(groupId);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.messages[0]).toMatchObject({ id: r.message.id, body: "<script>alert(1)</script>" }); // stored verbatim; the UI renders text
    expect((await (await get(groupId, `?ids=${r.message.id}`)).json()).messages).toHaveLength(1);
    for (const q of ["?before=abc", "?ids=1,x", "?limit=-1", "?after=1.5", `?ids=${Array.from({ length: 101 }, (_, i) => i + 1).join(",")}`]) {
      expect((await get(groupId, q)).status, q).toBe(400);
    }
  });
});
