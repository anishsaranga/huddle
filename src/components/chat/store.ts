/**
 * Client-side chat state (pure reducer, unit-tested): confirmed messages by
 * id plus this device's pending sends, merged from the initial page, history
 * pages, live refetches and action results. Dedupes by id; React keys stay
 * stable when a pending bubble is confirmed (so it doesn't remount/flash).
 */

import type { ChatAuthor, ChatMessage, ChatPage, ReactionSummary } from "@/lib/chat/types";

export type SendStatus = "sent" | "sending" | "failed";

export type ClientMessage = ChatMessage & {
  /** React key: `m-<id>`, or `c-<clientId>` for messages sent from this device. */
  key: string;
  status: SendStatus;
  /** Set on pending messages (and kept after confirmation). */
  clientId?: string;
  /** Arrived live / sent here: animate its entrance. */
  fresh?: boolean;
  /** `createdAt` as epoch ms and the author's id (timeline grouping). */
  at: number;
  authorId: string | null;
};

const derived = (m: ChatMessage) => ({ at: Date.parse(m.createdAt), authorId: m.author?.id ?? null });

export type ChatState = {
  /** Confirmed messages ascending by id, then pending ones in send order. */
  messages: ClientMessage[];
  hasMore: boolean;
};

export type ChatAction =
  | { type: "merge"; messages: ChatMessage[]; fresh?: boolean; viewerId: string }
  | { type: "older"; page: ChatPage }
  | { type: "reset"; page: ChatPage }
  | { type: "pending"; clientId: string; body: string; author: ChatAuthor; at: string }
  | { type: "confirm"; clientId: string; message: ChatMessage }
  | { type: "failed"; clientId: string }
  | { type: "retry"; clientId: string }
  | { type: "discard"; clientId: string }
  | { type: "reactions"; id: number; reactions: ReactionSummary[] }
  | { type: "deleted"; id: number };

const confirmed = (m: ChatMessage, extra: Partial<ClientMessage> = {}): ClientMessage => ({
  ...m,
  ...derived(m),
  key: `m-${m.id}`,
  status: "sent",
  ...extra,
});

export function initChatState(page: ChatPage): ChatState {
  return { messages: page.messages.map((m) => confirmed(m)), hasMore: page.hasMore };
}

function sortMessages(list: ClientMessage[]): ClientMessage[] {
  const done = list.filter((m) => m.status === "sent").sort((a, b) => a.id - b.id);
  const pending = list.filter((m) => m.status !== "sent");
  return [...done, ...pending];
}

/** Upsert confirmed messages, keeping each existing row's key / clientId. */
function upsert(list: ClientMessage[], incoming: ChatMessage[], extra: Partial<ClientMessage>): ClientMessage[] {
  if (incoming.length === 0) return list;
  const byId = new Map<number, number>();
  list.forEach((m, i) => m.status === "sent" && byId.set(m.id, i));
  const next = [...list];
  for (const m of incoming) {
    const i = byId.get(m.id);
    if (i !== undefined) {
      const cur = next[i];
      next[i] = { ...cur, ...m, ...derived(m), key: cur.key, status: "sent", clientId: cur.clientId, fresh: cur.fresh };
    } else {
      byId.set(m.id, next.length);
      next.push(confirmed(m, extra));
    }
  }
  return sortMessages(next);
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "merge": {
      const known = new Set(state.messages.filter((m) => m.status === "sent").map((m) => m.id));
      let list = state.messages;
      // A live copy of one of our own sends can beat the action's response: adopt the pending bubble
      // (same key, so no flash) instead of showing the message twice.
      for (const m of action.messages) {
        if (known.has(m.id) || m.author?.id !== action.viewerId || m.kind !== "text") continue;
        const p = list.find((x) => x.status === "sending" && x.body === m.body);
        if (!p) continue;
        list = list.map((x) => (x === p ? { ...x, ...m, ...derived(m), status: "sent" as const } : x));
        known.add(m.id);
      }
      return { ...state, messages: upsert(list, action.messages, { fresh: action.fresh }) };
    }
    case "older":
      return { messages: upsert(state.messages, action.page.messages, {}), hasMore: action.page.hasMore };
    case "reset": {
      const pending = state.messages.filter((m) => m.status !== "sent");
      return { messages: [...action.page.messages.map((m) => confirmed(m)), ...pending], hasMore: action.page.hasMore };
    }
    case "pending": {
      const m: ClientMessage = {
        id: 0,
        kind: "text",
        body: action.body,
        payload: null,
        createdAt: action.at,
        deleted: false,
        author: action.author,
        reactions: [],
        at: Date.parse(action.at),
        authorId: action.author.id,
        key: `c-${action.clientId}`,
        clientId: action.clientId,
        status: "sending",
        fresh: true,
      };
      return { ...state, messages: [...state.messages, m] };
    }
    case "confirm": {
      const p = state.messages.find((m) => m.clientId === action.clientId);
      if (!p) return { ...state, messages: upsert(state.messages, [action.message], { fresh: true }) };
      const already = state.messages.find((m) => m.status === "sent" && m.id === action.message.id && m !== p);
      const rest = state.messages.filter((m) => m !== p && m !== already);
      const merged: ClientMessage = {
        ...(already ?? {}),
        ...action.message,
        ...derived(action.message),
        key: p.key,
        clientId: p.clientId,
        status: "sent",
        fresh: true,
      };
      return { ...state, messages: sortMessages([...rest, merged]) };
    }
    case "failed":
    case "retry":
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.clientId === action.clientId && m.status !== "sent"
            ? { ...m, status: action.type === "failed" ? "failed" : "sending" }
            : m,
        ),
      };
    case "discard":
      return { ...state, messages: state.messages.filter((m) => !(m.clientId === action.clientId && m.status !== "sent")) };
    case "reactions":
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.status === "sent" && m.id === action.id ? { ...m, reactions: action.reactions } : m,
        ),
      };
    case "deleted":
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.status === "sent" && m.id === action.id ? { ...m, deleted: true, body: "", payload: null, reactions: [] } : m,
        ),
      };
  }
}

/** Toggle the viewer's `emoji` in a reaction list (optimistic update). */
export function toggleReactionLocal(list: ReactionSummary[], emoji: string): ReactionSummary[] {
  const cur = list.find((r) => r.emoji === emoji);
  if (!cur) return [...list, { emoji, count: 1, mine: true }];
  if (cur.mine) {
    return cur.count <= 1
      ? list.filter((r) => r.emoji !== emoji)
      : list.map((r) => (r.emoji === emoji ? { ...r, count: r.count - 1, mine: false } : r));
  }
  return list.map((r) => (r.emoji === emoji ? { ...r, count: r.count + 1, mine: true } : r));
}

/** Newest confirmed message id (0 when none). */
export function lastConfirmedId(state: ChatState): number {
  for (let i = state.messages.length - 1; i >= 0; i--) {
    if (state.messages[i].status === "sent") return state.messages[i].id;
  }
  return 0;
}

/** Oldest confirmed message id (0 when none). */
export function firstConfirmedId(state: ChatState): number {
  return state.messages.find((m) => m.status === "sent")?.id ?? 0;
}

/** Messages from others newer than `lastRead` (deleted ones don't count). */
export function unreadCount(state: ChatState, lastRead: number, viewerId: string): number {
  let n = 0;
  for (const m of state.messages) {
    if (m.status === "sent" && m.id > lastRead && !m.deleted && m.author?.id !== viewerId) n++;
  }
  return n;
}
