"use client";

import { createContext, useContext } from "react";

/**
 * Link between the group screen's tab strip and the chat panel: whether the
 * Chat tab is the one showing, and where the chat reports its unread count
 * (shown as a badge on the tab label).
 */
export type ChatTabBridge = { active: boolean; setUnread: (n: number) => void };

const noop = () => {};

export const ChatTabContext = createContext<ChatTabBridge>({ active: true, setUnread: noop });

export function useChatTab(): ChatTabBridge {
  return useContext(ChatTabContext);
}
