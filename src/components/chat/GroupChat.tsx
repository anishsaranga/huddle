"use client";

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import { copyText } from "@/components/apikey/clipboard";
import { ConfirmSheet } from "@/components/ui/ConfirmSheet";
import { useToast } from "@/components/ui/Toast";
import { deleteMessageAction, sendMessageAction, toggleReactionAction } from "@/lib/chat/actions";
import { buildTimeline } from "@/lib/chat/timeline";
import type { ChatAuthor, ChatPage, GroupEvent } from "@/lib/chat/types";
import { todayIn } from "@/lib/tz";
import { spring } from "@/lib/ui/motion";
import type { BubblePosition } from "./Bubble";
import { useChatTab } from "./ChatTabContext";
import { Composer, type ComposerMetrics } from "./Composer";
import { MessageList, type TimelineMessage } from "./MessageList";
import { MessageMenu, type MenuTarget } from "./MessageMenu";
import {
  chatReducer,
  firstConfirmedId,
  initChatState,
  lastConfirmedId,
  toggleReactionLocal,
  unreadCount,
  type ClientMessage,
} from "./store";
import { useGroupStream } from "./useGroupStream";

type GroupChatProps = {
  groupId: string;
  groupName: string;
  viewer: ChatAuthor;
  /** The viewer's timezone: day separators and times. */
  tz: string;
  /** Today in `tz` when the server rendered (kept fresh on the client). */
  today: string;
  initial: ChatPage;
};

const NEAR_BOTTOM_PX = 96;
const LOAD_OLDER_PX = 480;
/**
 * Server-render estimate of the panel height (header + tab strip + tab bar); measured on mount.
 * The app shell is 100dvh + --vh-gap tall (h-app), so the estimate adds the gap too.
 */
const FALLBACK_HEIGHT =
  "calc(100dvh + var(--vh-gap, 0px) - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 195px)";

async function fetchPage(groupId: string, query: string): Promise<ChatPage | null> {
  try {
    const res = await fetch(`/api/groups/${groupId}/messages${query ? `?${query}` : ""}`, { cache: "no-store" });
    return res.ok ? ((await res.json()) as ChatPage) : null;
  } catch {
    return null;
  }
}

const storageKey = (userId: string, groupId: string) => `huddle:chat:lastRead:${userId}:${groupId}`;

function readLastRead(key: string): number | null {
  try {
    const v = window.localStorage.getItem(key);
    return v && /^\d+$/.test(v) ? Number(v) : null;
  } catch {
    return null;
  }
}

function writeLastRead(key: string, id: number) {
  try {
    window.localStorage.setItem(key, String(id));
  } catch {
    // Private mode / storage full: the badge just won't persist.
  }
}

/**
 * Group chat panel (the group screen's Chat tab): history with infinite
 * scroll up, live updates over SSE, optimistic sends and reactions, the
 * long-press menu, and the composer pinned above the tab bar / keyboard.
 */
export function GroupChat({ groupId, groupName, viewer, tz, today: serverToday, initial }: GroupChatProps) {
  const { toast } = useToast();
  const { active, setUnread } = useChatTab();
  const [state, dispatch] = useReducer(chatReducer, initial, initChatState);
  const stateRef = useRef(state);
  useLayoutEffect(() => {
    stateRef.current = state;
  });

  const [today, setToday] = useState(serverToday);
  useEffect(() => {
    const tick = () => setToday(todayIn(tz));
    tick();
    const t = setInterval(tick, 60_000);
    return () => clearInterval(t);
  }, [tz]);

  /* ---------------- Live fetch (coalesced) ---------------- */

  const queued = useRef(new Set<number>());
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reacting = useRef(new Map<number, number>()); // message id -> reaction toggles in flight

  const flush = useCallback(async () => {
    flushTimer.current = null;
    const ids = [...queued.current];
    queued.current.clear();
    if (ids.length === 0) return;
    const page = await fetchPage(groupId, `ids=${ids.join(",")}`);
    if (!page) return;
    // Don't let a refetch undo an optimistic reaction that's still being saved.
    const current = new Map(stateRef.current.messages.map((m) => [m.id, m]));
    const messages = page.messages.map((m) =>
      reacting.current.get(m.id) ? { ...m, reactions: current.get(m.id)?.reactions ?? m.reactions } : m,
    );
    dispatch({ type: "merge", messages, fresh: true, viewerId: viewer.id });
  }, [groupId, viewer.id]);

  const enqueue = useCallback(
    (id: number) => {
      queued.current.add(id);
      if (!flushTimer.current) flushTimer.current = setTimeout(flush, 40);
    },
    [flush],
  );

  const resync = useCallback(async () => {
    const page = await fetchPage(groupId, "");
    if (page) dispatch({ type: "merge", messages: page.messages, viewerId: viewer.id });
  }, [groupId, viewer.id]);

  useGroupStream(groupId, {
    lastId: () => lastConfirmedId(stateRef.current),
    onEvent: (e: GroupEvent) => enqueue(e.id),
    onReset: async () => {
      const page = await fetchPage(groupId, "");
      if (page) dispatch({ type: "reset", page });
    },
    onResync: resync,
  });

  /* ---------------- Layout: panel height, composer padding ---------------- */

  const panelRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [panelH, setPanelH] = useState<number | null>(null);
  const [metrics, setMetrics] = useState<ComposerMetrics | null>(null);
  const [padBottom, setPadBottom] = useState(88);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    const main = panel?.closest("main");
    if (!panel || !main) return;
    // Fill the space between the tab strip and the page's bottom padding (above the tab bar),
    // so the page itself never scrolls on this tab; the list scrolls inside.
    const measure = () => {
      const pad = parseFloat(getComputedStyle(main).paddingBottom) || 0;
      const top = panel.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop;
      setPanelH(Math.max(260, Math.floor(main.clientHeight - pad - top)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(main);
    // The page's entrance transform and web fonts can shift the top after the first paint.
    const late = setTimeout(measure, 450);
    document.fonts?.ready.then(measure).catch(() => {});
    return () => {
      ro.disconnect();
      clearTimeout(late);
    };
  }, [active]);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel || !metrics) return;
    // metrics.bottom is the composer's resolved `bottom` (already minus --vh-gap), relative to the
    // same layout viewport innerHeight describes, so no separate gap term here.
    const composerTop = window.innerHeight - metrics.bottom - metrics.height;
    const overlap = panel.getBoundingClientRect().bottom - composerTop;
    setPadBottom(Math.max(16, Math.round(overlap + 12)));
  }, [metrics, panelH]);

  /* ---------------- Scrolling ---------------- */

  const nearBottom = useRef(true);
  const anchor = useRef<{ height: number; top: number } | null>(null);
  const [newCount, setNewCount] = useState(0);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const loadingRef = useRef(false);

  const scrollToBottom = useCallback((smooth: boolean) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);

  const loadOlder = useCallback(async () => {
    const s = stateRef.current;
    if (loadingRef.current || !s.hasMore) return;
    const before = firstConfirmedId(s);
    if (!before) return;
    loadingRef.current = true;
    setLoadingOlder(true);
    const page = await fetchPage(groupId, `before=${before}`);
    const el = scrollerRef.current;
    if (page && el) {
      anchor.current = { height: el.scrollHeight, top: el.scrollTop };
      dispatch({ type: "older", page });
    }
    loadingRef.current = false;
    setLoadingOlder(false);
  }, [groupId]);

  const onScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    nearBottom.current = dist < NEAR_BOTTOM_PX;
    if (nearBottom.current && newCount) setNewCount(0);
    if (el.scrollTop < LOAD_OLDER_PX) void loadOlder();
  };

  // First paint: start at the newest message.
  useLayoutEffect(() => {
    scrollToBottom(false);
  }, [scrollToBottom]);

  // React to list changes: keep the viewport steady when history is prepended, follow new
  // messages when already at the bottom (or when it's our own), otherwise count them.
  const lastKey = useRef(state.messages.at(-1)?.key);
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    if (anchor.current) {
      el.scrollTop = anchor.current.top + (el.scrollHeight - anchor.current.height);
      anchor.current = null;
    }
    const list = state.messages;
    const last = list.at(-1);
    if (!last || last.key === lastKey.current) return;
    const prevIndex = list.findIndex((m) => m.key === lastKey.current);
    const added = prevIndex === -1 ? [last] : list.slice(prevIndex + 1);
    lastKey.current = last.key;
    const ownNew = added.some((m) => m.author?.id === viewer.id && m.fresh);
    if (ownNew || nearBottom.current) {
      scrollToBottom(true);
    } else {
      const others = added.filter((m) => m.author?.id !== viewer.id && m.status === "sent").length;
      if (others) setNewCount((c) => c + others);
    }
  }, [state.messages, viewer.id, scrollToBottom]);

  // Content that grows at the bottom (reactions, the keyboard padding) keeps us pinned.
  const contentRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    const content = contentRef.current;
    if (!el || !content) return;
    const ro = new ResizeObserver(() => {
      if (nearBottom.current && !anchor.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(content);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The bar moved (keyboard opened, composer grew): stay on the newest message if we were there.
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (el && nearBottom.current) el.scrollTop = el.scrollHeight;
  }, [padBottom]);

  // Short histories: keep loading until the list can scroll (so "scroll up for more" works).
  useEffect(() => {
    const el = scrollerRef.current;
    if (el && state.hasMore && !loadingOlder && el.scrollHeight <= el.clientHeight + LOAD_OLDER_PX / 2) void loadOlder();
  }, [state.hasMore, state.messages.length, loadingOlder, loadOlder, panelH]);

  /* ---------------- Unread badge ---------------- */

  // Last message id seen on this device (localStorage); unread = newer messages from others.
  const lastRead = useRef<number | null>(null);
  const newest = lastConfirmedId(state);
  useEffect(() => {
    const key = storageKey(viewer.id, groupId);
    // First visit: everything so far counts as read.
    if (lastRead.current === null) lastRead.current = readLastRead(key) ?? newest;
    if (active && newest > lastRead.current) {
      lastRead.current = newest;
      writeLastRead(key, newest);
    }
    setUnread(active ? 0 : unreadCount(state, lastRead.current, viewer.id));
  }, [active, newest, state, viewer.id, groupId, setUnread]);

  // Coming back to the tab: jump to the newest message.
  const wasActive = useRef(active);
  useEffect(() => {
    if (active && !wasActive.current) {
      scrollToBottom(false);
      nearBottom.current = true;
      setNewCount(0);
    }
    wasActive.current = active;
  }, [active, scrollToBottom]);

  /* ---------------- Actions ---------------- */

  const send = useCallback(
    async (body: string, existingClientId?: string) => {
      const clientId = existingClientId ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      if (existingClientId) dispatch({ type: "retry", clientId });
      else dispatch({ type: "pending", clientId, body, author: viewer, at: new Date().toISOString() });
      nearBottom.current = true;
      let res: Awaited<ReturnType<typeof sendMessageAction>>;
      try {
        res = await sendMessageAction(groupId, body);
      } catch {
        res = { ok: false, code: "network", error: "Check your connection and try again." };
      }
      if (res.ok) {
        dispatch({ type: "confirm", clientId, message: res.message });
        return;
      }
      dispatch({ type: "failed", clientId });
      toast({
        title: "Message not sent",
        description:
          res.code === "rate_limited" && res.retryAfterSec
            ? `Slow down a little. Try again in ${res.retryAfterSec} s.`
            : res.error,
        tone: "error",
        duration: 4200,
      });
    },
    [groupId, viewer, toast],
  );

  const react = useCallback(
    async (message: TimelineMessage | ClientMessage, emoji: string) => {
      if (message.status !== "sent" || message.deleted) return;
      const id = message.id;
      const before = stateRef.current.messages.find((m) => m.status === "sent" && m.id === id)?.reactions ?? message.reactions;
      dispatch({ type: "reactions", id, reactions: toggleReactionLocal(before, emoji) });
      reacting.current.set(id, (reacting.current.get(id) ?? 0) + 1);
      let res: Awaited<ReturnType<typeof toggleReactionAction>>;
      try {
        res = await toggleReactionAction(groupId, id, emoji);
      } catch {
        res = { ok: false, code: "network", error: "Check your connection and try again." };
      }
      const left = (reacting.current.get(id) ?? 1) - 1;
      if (left > 0) reacting.current.set(id, left);
      else reacting.current.delete(id);
      if (res.ok) {
        if (left === 0) dispatch({ type: "reactions", id, reactions: res.reactions });
      } else {
        toast({ title: "Reaction not saved", description: res.error, tone: "error" });
        enqueue(id);
      }
    },
    [groupId, toast, enqueue],
  );

  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<TimelineMessage | null>(null);
  const [deleting, setDeleting] = useState(false);

  const openMenu = useCallback(
    (message: TimelineMessage, el: HTMLElement, position: BubblePosition) => {
      const r = el.getBoundingClientRect();
      setMenu({
        message,
        position,
        mine: message.author?.id === viewer.id,
        rect: { top: r.top, left: r.left, width: r.width, height: r.height },
      });
    },
    [viewer.id],
  );
  const closeMenu = useCallback(() => setMenu(null), []);

  const doDelete = async () => {
    const target = confirmDelete;
    if (!target) return;
    setDeleting(true);
    let res: Awaited<ReturnType<typeof deleteMessageAction>>;
    try {
      res = await deleteMessageAction(groupId, target.id);
    } catch {
      res = { ok: false, code: "network", error: "Check your connection and try again." };
    }
    setDeleting(false);
    setConfirmDelete(null);
    if (res.ok) dispatch({ type: "deleted", id: target.id });
    else toast({ title: "Couldn't delete that", description: res.error, tone: "error" });
  };

  const retry = useCallback((m: TimelineMessage) => m.clientId && void send(m.body, m.clientId), [send]);
  const discard = useCallback((m: TimelineMessage) => m.clientId && dispatch({ type: "discard", clientId: m.clientId }), []);

  /* ---------------- Render ---------------- */

  const items = useMemo(() => buildTimeline(state.messages, tz, today), [state.messages, tz, today]);

  const empty = state.messages.length === 0;

  return (
    <div
      ref={panelRef}
      className="relative"
      style={{ height: panelH ?? FALLBACK_HEIGHT }}
      data-testid="group-chat"
    >
      <div
        ref={scrollerRef}
        onScroll={onScroll}
        className="scroll-area absolute inset-0 overflow-x-hidden"
        // Messages fade out under the tab strip instead of being cut off.
        style={{ paddingBottom: padBottom, maskImage: "linear-gradient(180deg, transparent 0, #000 20px)", WebkitMaskImage: "linear-gradient(180deg, transparent 0, #000 20px)" }}
        role="log"
        aria-label={`${groupName} chat`}
        aria-live="polite"
      >
        <div ref={contentRef} className="flex min-h-full flex-col px-3 pt-1">
          {empty ? (
            <EmptyChat groupName={groupName} onWave={() => void send("👋")} />
          ) : (
            <>
              <div className="mt-auto" />
              <HistoryEdge loading={loadingOlder} hasMore={state.hasMore} groupName={groupName} />
              <MessageList
                items={items}
                viewerId={viewer.id}
                tz={tz}
                onMenu={openMenu}
                onReact={react}
                onRetry={retry}
                onDiscard={discard}
              />
            </>
          )}
        </div>
      </div>

      <AnimatePresence>
        {newCount > 0 && (
          <motion.button
            type="button"
            key="pill"
            onClick={() => {
              scrollToBottom(true);
              setNewCount(0);
            }}
            initial={{ opacity: 0, y: 12, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.9, transition: { duration: 0.15 } }}
            transition={spring.bouncy}
            whileTap={{ scale: 0.94 }}
            className="absolute left-1/2 z-10 flex h-8 -translate-x-1/2 items-center gap-1.5 rounded-full bg-white pl-3.5 pr-3 text-[12.5px] font-semibold text-bg shadow-[0_8px_24px_-6px_rgb(0_0_0/0.8),0_0_18px_rgb(255_255_255/0.18)]"
            style={{ bottom: padBottom + 6 }}
          >
            <span className="num font-mono">{newCount}</span>
            {newCount === 1 ? "new message" : "new messages"}
            <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5.5 12.5 12 19l6.5-6.5" />
            </svg>
          </motion.button>
        )}
      </AnimatePresence>

      <Composer visible={active} placeholder={`Message ${groupName}`} onSend={(b) => void send(b)} onMetrics={setMetrics} />

      <MessageMenu
        target={menu}
        onClose={closeMenu}
        onReact={(emoji) => {
          const m = menu?.message;
          setMenu(null);
          if (m) void react(m, emoji);
        }}
        onCopy={async () => {
          const m = menu?.message;
          setMenu(null);
          if (m && (await copyText(m.body))) toast({ title: "Copied", tone: "success", duration: 1600 });
        }}
        onDelete={() => {
          const m = menu?.message;
          setMenu(null);
          if (m) setConfirmDelete(m);
        }}
      />

      <ConfirmSheet
        open={!!confirmDelete}
        onClose={() => !deleting && setConfirmDelete(null)}
        onConfirm={doDelete}
        title="Delete message?"
        confirmLabel="Delete for everyone"
        destructive
        pending={deleting}
      >
        It will show as &ldquo;Message deleted&rdquo; for everyone in {groupName}.
      </ConfirmSheet>
    </div>
  );
}

function HistoryEdge({ loading, hasMore, groupName }: { loading: boolean; hasMore: boolean; groupName: string }) {
  if (hasMore) {
    return (
      <div className="flex h-10 items-center justify-center" aria-hidden={!loading}>
        {loading && (
          <span className="flex gap-1" role="status" aria-label="Loading earlier messages">
            {[0, 1, 2].map((i) => (
              <motion.span
                key={i}
                className="size-1.5 rounded-full bg-text-2"
                animate={{ opacity: [0.25, 1, 0.25] }}
                transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15 }}
              />
            ))}
          </span>
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-2 pb-2 pt-6 text-center">
      <span className="grid size-10 place-items-center rounded-full bg-white/[0.04] shadow-[inset_0_0_0_1px_var(--hairline-strong)]">
        <ChatGlyph size={18} />
      </span>
      <p className="telemetry text-[10px]">START OF {groupName.toUpperCase()}</p>
    </div>
  );
}

function EmptyChat({ groupName, onWave }: { groupName: string; onWave: () => void }) {
  return (
    <div className="my-auto flex flex-col items-center px-6 py-10 text-center">
      <div className="relative mb-6 grid size-20 place-items-center rounded-full bg-white/[0.04] shadow-[inset_0_0_0_1px_var(--hairline-strong)]">
        <ChatGlyph size={32} />
        <span aria-hidden className="absolute -inset-3 rounded-full border border-dashed border-hairline" />
      </div>
      <p className="font-display text-[26px] font-bold uppercase leading-none tracking-[0.03em]">Say hi to {groupName} 👋</p>
      <p className="mt-3 max-w-[30ch] text-[15px] leading-relaxed text-muted">
        Banter, reactions and the weekly champions post live here. Only the group can see it.
      </p>
      <motion.button
        type="button"
        onClick={onWave}
        whileTap={{ scale: 0.94 }}
        transition={spring.press}
        className="mt-6 flex h-10 items-center gap-2 rounded-full bg-white/[0.06] px-4 text-[13px] font-semibold uppercase tracking-[0.1em] text-text shadow-[inset_0_0_0_1px_var(--hairline-strong)]"
      >
        <span aria-hidden className="text-[18px] normal-case">👋</span> Wave
      </motion.button>
    </div>
  );
}

function ChatGlyph({ size }: { size: number }) {
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="text-text-2">
      <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H10l-4.2 3.4c-.5.4-1.3 0-1.3-.6V16.9A2.5 2.5 0 0 1 4 15.5z" />
      <path d="M8.5 9.2h7M8.5 12.2h4" />
    </svg>
  );
}
