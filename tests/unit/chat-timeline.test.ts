import { describe, expect, it } from "vitest";
import { chatReducer, initChatState, lastConfirmedId, toggleReactionLocal, unreadCount, type ChatState } from "@/components/chat/store";
import { buildTimeline, dayLabel, GROUP_GAP_MS, timeLabel, type TimelineInput } from "@/lib/chat/timeline";
import type { ChatAuthor, ChatMessage } from "@/lib/chat/types";

const TZ = "Europe/Berlin";
const at = (iso: string) => Date.parse(iso);
let n = 0;
const msg = (authorId: string | null, iso: string, kind: TimelineInput["kind"] = "text"): TimelineInput => ({
  key: `k${++n}`,
  authorId,
  kind,
  at: at(iso),
});

describe("buildTimeline", () => {
  it("groups consecutive messages by author and splits on a 5-minute gap", () => {
    const list = [
      msg("a", "2026-09-29T08:00:00Z"),
      msg("a", "2026-09-29T08:04:59Z"), // same group (< 5 min)
      msg("a", "2026-09-29T08:09:59Z"), // exactly 5 min later: new group
      msg("b", "2026-09-29T08:10:30Z"), // other author: new group
      msg("a", "2026-09-29T08:11:00Z"), // back to a: new group
    ];
    const items = buildTimeline(list, TZ, "2026-09-29");
    expect(items.map((i) => i.type)).toEqual(["day", "group", "group", "group", "group"]);
    const groups = items.filter((i) => i.type === "group");
    expect(groups.map((g) => g.messages.length)).toEqual([2, 1, 1, 1]);
    expect(groups.map((g) => g.authorId)).toEqual(["a", "a", "b", "a"]);
    expect(GROUP_GAP_MS).toBe(300_000);
  });

  it("inserts day separators in the viewer's timezone and labels them", () => {
    const list = [
      msg("a", "2026-09-26T10:00:00Z"), // Sat
      msg("a", "2026-09-28T21:50:00Z"), // Mon 23:50 Berlin
      msg("a", "2026-09-28T22:10:00Z"), // Tue 00:10 Berlin: a new day
      msg("a", "2026-09-28T22:12:00Z"),
    ];
    const items = buildTimeline(list, TZ, "2026-09-29");
    expect(items.filter((i) => i.type === "day").map((i) => (i as { label: string }).label)).toEqual([
      "SAT · SEP 26",
      "YESTERDAY",
      "TODAY",
    ]);
    // In New York the last three are all on Monday.
    const ny = buildTimeline(list, "America/New_York", "2026-09-29");
    expect(ny.filter((i) => i.type === "day").map((i) => (i as { label: string }).label)).toEqual(["SAT · SEP 26", "YESTERDAY"]);
  });

  it("a day change always starts a new group, even within 5 minutes", () => {
    const items = buildTimeline(
      [msg("a", "2026-09-28T21:58:00Z"), msg("a", "2026-09-28T22:01:00Z")],
      TZ,
      "2026-09-29",
    );
    expect(items.map((i) => i.type)).toEqual(["day", "group", "day", "group"]);
  });

  it("system and champions posts are standalone cards that break groups", () => {
    const items = buildTimeline(
      [
        msg("a", "2026-09-29T08:00:00Z"),
        msg(null, "2026-09-29T08:01:00Z", "champions"),
        msg("a", "2026-09-29T08:02:00Z"),
        msg(null, "2026-09-29T08:02:30Z", "system"),
      ],
      TZ,
      "2026-09-29",
    );
    expect(items.map((i) => i.type)).toEqual(["day", "group", "card", "group", "card"]);
  });

  it("messages from deleted users (null author) group together as 'Deleted user'", () => {
    const items = buildTimeline([msg(null, "2026-09-29T08:00:00Z"), msg(null, "2026-09-29T08:01:00Z")], TZ, "2026-09-29");
    expect(items.filter((i) => i.type === "group")).toHaveLength(1);
  });

  it("labels", () => {
    expect(dayLabel("2026-09-29", "2026-09-29")).toBe("TODAY");
    expect(dayLabel("2026-09-28", "2026-09-29")).toBe("YESTERDAY");
    expect(dayLabel("2026-09-21", "2026-09-29")).toBe("MON · SEP 21");
    expect(dayLabel("2025-12-31", "2026-09-29")).toBe("WED · DEC 31 2025");
    expect(timeLabel(at("2026-09-29T05:42:00Z"), TZ)).toBe("7:42 AM");
    expect(timeLabel(at("2026-09-29T10:05:00Z"), TZ)).toBe("12:05 PM");
    expect(timeLabel(at("2026-09-28T22:05:00Z"), TZ)).toBe("12:05 AM");
  });
});

/* ------------------------------------------------------------------------ */

const me: ChatAuthor = { id: "me", displayName: "Me", username: "me", avatarKind: null, avatarConfig: null, avatarPath: null };
const them: ChatAuthor = { ...me, id: "them", displayName: "Them", username: "them" };
const server = (id: number, author: ChatAuthor | null, body = `m${id}`): ChatMessage => ({
  id,
  kind: "text",
  body,
  payload: null,
  createdAt: new Date(Date.UTC(2026, 8, 29, 8, id)).toISOString(),
  deleted: false,
  author,
  reactions: [],
});

describe("chat store", () => {
  const base = (): ChatState => initChatState({ messages: [server(10, them), server(11, me)], hasMore: true });

  it("merges live messages in id order and dedupes", () => {
    let s = base();
    s = chatReducer(s, { type: "merge", messages: [server(13, them), server(12, them)], fresh: true, viewerId: "me" });
    s = chatReducer(s, { type: "merge", messages: [server(12, them)], fresh: true, viewerId: "me" });
    expect(s.messages.map((m) => m.id)).toEqual([10, 11, 12, 13]);
    expect(s.messages[2].fresh).toBe(true);
    expect(lastConfirmedId(s)).toBe(13);
  });

  it("prepends older pages", () => {
    const s = chatReducer(base(), { type: "older", page: { messages: [server(8, them), server(9, them)], hasMore: false } });
    expect(s.messages.map((m) => m.id)).toEqual([8, 9, 10, 11]);
    expect(s.hasMore).toBe(false);
  });

  it("pending -> confirmed keeps the React key; a live copy arriving first is adopted, not duplicated", () => {
    let s = chatReducer(base(), { type: "pending", clientId: "c1", body: "hello", author: me, at: "2026-09-29T09:00:00Z" });
    expect(s.messages.at(-1)).toMatchObject({ status: "sending", key: "c-c1" });
    // SSE refetch wins the race.
    s = chatReducer(s, { type: "merge", messages: [server(20, me, "hello")], fresh: true, viewerId: "me" });
    expect(s.messages.filter((m) => m.body === "hello")).toHaveLength(1);
    // Then the action result lands.
    s = chatReducer(s, { type: "confirm", clientId: "c1", message: server(20, me, "hello") });
    const hello = s.messages.filter((m) => m.body === "hello");
    expect(hello).toHaveLength(1);
    expect(hello[0]).toMatchObject({ id: 20, status: "sent", key: "c-c1" });
  });

  it("failed sends can be retried or discarded; pending stays after confirmed messages", () => {
    let s = chatReducer(base(), { type: "pending", clientId: "c2", body: "x", author: me, at: "2026-09-29T09:00:00Z" });
    s = chatReducer(s, { type: "failed", clientId: "c2" });
    expect(s.messages.at(-1)?.status).toBe("failed");
    s = chatReducer(s, { type: "merge", messages: [server(30, them)], viewerId: "me" });
    expect(s.messages.at(-1)?.status).toBe("failed");
    expect(s.messages.at(-2)?.id).toBe(30);
    s = chatReducer(s, { type: "retry", clientId: "c2" });
    expect(s.messages.at(-1)?.status).toBe("sending");
    s = chatReducer(s, { type: "discard", clientId: "c2" });
    expect(s.messages.some((m) => m.clientId === "c2")).toBe(false);
  });

  it("reactions toggle optimistically and deletes clear the body", () => {
    expect(toggleReactionLocal([], "🔥")).toEqual([{ emoji: "🔥", count: 1, mine: true }]);
    expect(toggleReactionLocal([{ emoji: "🔥", count: 1, mine: true }], "🔥")).toEqual([]);
    expect(toggleReactionLocal([{ emoji: "🔥", count: 2, mine: true }], "🔥")).toEqual([{ emoji: "🔥", count: 1, mine: false }]);
    expect(toggleReactionLocal([{ emoji: "🔥", count: 2, mine: false }], "🔥")).toEqual([{ emoji: "🔥", count: 3, mine: true }]);
    let s = chatReducer(base(), { type: "reactions", id: 10, reactions: [{ emoji: "💪", count: 1, mine: true }] });
    expect(s.messages[0].reactions).toHaveLength(1);
    s = chatReducer(s, { type: "deleted", id: 10 });
    expect(s.messages[0]).toMatchObject({ deleted: true, body: "", reactions: [] });
  });

  it("counts unread messages from others after the last read id", () => {
    let s = base();
    s = chatReducer(s, { type: "merge", messages: [server(12, them), server(13, me), server(14, them)], viewerId: "me" });
    s = chatReducer(s, { type: "deleted", id: 14 });
    expect(unreadCount(s, 11, "me")).toBe(1);
    expect(unreadCount(s, 9, "me")).toBe(2);
    expect(unreadCount(s, 14, "me")).toBe(0);
  });
});
