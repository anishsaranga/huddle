/**
 * Chat DTOs shared by the server (queries, actions, API routes) and the
 * client components. Serializable only (dates as ISO strings).
 */

import type { AvatarConfig, AvatarKind, MessageKind } from "@/db/schema";

export type ChatAuthor = {
  id: string;
  displayName: string | null;
  username: string | null;
  avatarKind: AvatarKind | null;
  avatarConfig: AvatarConfig | null;
  avatarPath: string | null;
};

/** One emoji's reactions on a message, from the viewer's point of view. */
export type ReactionSummary = { emoji: string; count: number; mine: boolean };

export type ChatMessage = {
  id: number;
  kind: MessageKind;
  /** Empty for deleted messages. Plain text: render as text nodes only. */
  body: string;
  payload: Record<string, unknown> | null;
  /** ISO timestamp. */
  createdAt: string;
  deleted: boolean;
  /** null for system / champions posts and for authors whose account was deleted. */
  author: ChatAuthor | null;
  /** In first-reaction order. Empty for deleted messages. */
  reactions: ReactionSummary[];
};

/** A page of history (ascending by id). `hasMore` = older messages exist. */
export type ChatPage = { messages: ChatMessage[]; hasMore: boolean };

/**
 * Live events sent through Postgres NOTIFY and the SSE stream. Deliberately
 * tiny (ids only): clients refetch the details, which also keeps per-viewer
 * fields such as `mine` out of the broadcast.
 */
export type GroupEventType = "message" | "reaction" | "delete";
export type GroupEvent = { type: GroupEventType; id: number };

export const GROUP_EVENT_TYPES: readonly GroupEventType[] = ["message", "reaction", "delete"];

export function isGroupEvent(value: unknown): value is GroupEvent {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.type === "string" &&
    (GROUP_EVENT_TYPES as readonly string[]).includes(v.type) &&
    typeof v.id === "number" &&
    Number.isSafeInteger(v.id) &&
    v.id > 0
  );
}

/** Messages per history page. */
export const CHAT_PAGE_SIZE = 30;
