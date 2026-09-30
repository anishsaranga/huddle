"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { REACTION_EMOJI } from "@/lib/chat/emoji";
import { spring } from "@/lib/ui/motion";
import { BubbleBody, type BubblePosition } from "./Bubble";
import type { TimelineMessage } from "./MessageList";

export type MenuTarget = {
  message: TimelineMessage;
  mine: boolean;
  position: BubblePosition;
  /** The bubble's rect when the menu opened (viewport coordinates). */
  rect: { top: number; left: number; width: number; height: number };
};

type MessageMenuProps = {
  target: MenuTarget | null;
  onClose: () => void;
  onReact: (emoji: string) => void;
  onCopy: () => void;
  onDelete: () => void;
};

const CELL = 44;
const COLS = 6;
const PAD = 6;
const PANEL_W = COLS * CELL + PAD * 2;
const PANEL_H = Math.ceil(REACTION_EMOJI.length / COLS) * CELL + PAD * 2;
const ITEM_H = 46;
const MENU_W = 208;
const GAP = 10;
const EDGE = 12;

const subscribe = () => () => {};

/**
 * Long-press / right-click menu: the pressed bubble lifts over a dimmed
 * backdrop with the reaction palette above it and Copy / Delete below
 * (iMessage-style). The whole stack shifts vertically to stay on screen.
 */
export function MessageMenu({ target, onClose, onReact, onCopy, onDelete }: MessageMenuProps) {
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  if (!mounted) return null;
  return createPortal(
    <AnimatePresence>
      {target && (
        <MenuOverlay key={target.message.key} target={target} onClose={onClose} onReact={onReact} onCopy={onCopy} onDelete={onDelete} />
      )}
    </AnimatePresence>,
    document.body,
  );
}

function MenuOverlay({ target, onClose, onReact, onCopy, onDelete }: MessageMenuProps & { target: MenuTarget }) {
  const firstRef = useRef<HTMLButtonElement>(null);
  const { message, mine, position, rect } = target;
  const items = [{ id: "copy", label: "Copy", onSelect: onCopy }, ...(mine ? [{ id: "delete", label: "Delete", onSelect: onDelete }] : [])];
  const menuH = items.length * ITEM_H + 8;

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    firstRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prev?.focus?.({ preventScroll: true });
    };
  }, [onClose]);

  // Layout in viewport coordinates.
  const vw = window.innerWidth;
  const vh = window.visualViewport?.height ?? window.innerHeight;
  const minTop = 56;
  const maxBottom = vh - 16;
  const stackTop = rect.top - PANEL_H - GAP;
  const stackBottom = rect.top + rect.height + GAP + menuH;
  let dy = 0;
  // Keep the palette on screen first; then pull the stack up if the menu would fall off the bottom.
  if (stackTop < minTop) dy = minTop - stackTop;
  else if (stackBottom > maxBottom) dy = Math.max(maxBottom - stackBottom, minTop - stackTop);
  const top = rect.top + dy;
  // The lifted bubble scales from its bottom edge, so it grows upward.
  const lift = rect.height * 0.03;
  const panelLeft = mine
    ? Math.max(EDGE, Math.min(rect.left + rect.width - PANEL_W, vw - EDGE - PANEL_W))
    : Math.min(Math.max(EDGE, rect.left), vw - EDGE - PANEL_W);
  const menuLeft = mine
    ? Math.max(EDGE, rect.left + rect.width - MENU_W)
    : Math.min(Math.max(EDGE, rect.left), vw - EDGE - MENU_W);
  const mineSet = new Set(message.reactions.filter((r) => r.mine).map((r) => r.emoji));
  const origin = mine ? "100% 100%" : "0% 100%";

  return (
    <div className="fixed inset-0 z-[65]" role="dialog" aria-modal="true" aria-label="Message actions">
      <motion.div
        aria-hidden
        className="absolute inset-0 bg-black/65"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0, transition: { duration: 0.18 } }}
        transition={{ duration: 0.2 }}
        onClick={onClose}
      />

      {/* The lifted bubble. */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute"
        style={{ left: rect.left, top: rect.top, width: rect.width, transformOrigin: origin }}
        initial={{ y: 0, scale: 1 }}
        animate={{ y: dy, scale: 1.03 }}
        exit={{ y: 0, scale: 1, opacity: 0, transition: { duration: 0.16 } }}
        transition={spring.sheet}
      >
        <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
          <BubbleBody
            body={message.body}
            deleted={false}
            mine={mine}
            position={position}
            className="shadow-[0_18px_40px_-12px_rgb(0_0_0/0.9)]"
          />
        </div>
      </motion.div>

      {/* Reaction palette. */}
      <motion.div
        role="group"
        aria-label="Reactions"
        className="surface surface-elevated absolute grid rounded-[22px]"
        style={{
          left: panelLeft,
          top: top - lift - PANEL_H - GAP,
          width: PANEL_W,
          padding: PAD,
          gridTemplateColumns: `repeat(${COLS}, ${CELL}px)`,
          transformOrigin: mine ? "85% 100%" : "15% 100%",
        }}
        initial={{ opacity: 0, scale: 0.6, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.8, y: 6, transition: { duration: 0.14 } }}
        transition={spring.bouncy}
      >
        {REACTION_EMOJI.map((emoji, i) => {
          const on = mineSet.has(emoji);
          return (
            <motion.button
              key={emoji}
              ref={i === 0 ? firstRef : undefined}
              type="button"
              aria-label={`React with ${emoji}`}
              aria-pressed={on}
              onClick={() => onReact(emoji)}
              initial={{ opacity: 0, scale: 0.3 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ ...spring.bouncy, delay: 0.015 * i }}
              whileTap={{ scale: 1.35 }}
              className={`grid size-11 place-items-center rounded-full text-[25px] leading-none outline-offset-0 transition-colors ${
                on ? "bg-white/[0.14] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.3)]" : "active:bg-white/[0.08]"
              }`}
            >
              {emoji}
            </motion.button>
          );
        })}
      </motion.div>

      {/* Actions. */}
      <motion.div
        role="menu"
        aria-label="Message"
        className="surface surface-elevated absolute overflow-hidden rounded-2xl p-1"
        style={{
          left: menuLeft,
          top: top + rect.height + GAP,
          width: MENU_W,
          transformOrigin: mine ? "100% 0%" : "0% 0%",
        }}
        initial={{ opacity: 0, scale: 0.85, y: -8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.14 } }}
        transition={spring.sheet}
      >
        {items.map((item, i) => (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            onClick={item.onSelect}
            className={`flex w-full items-center justify-between rounded-xl px-3.5 text-left text-[15px] font-medium transition-colors active:bg-white/[0.08] ${
              i > 0 ? "border-t border-hairline" : ""
            } ${item.id === "delete" ? "text-recovery-red" : "text-text"}`}
            style={{ height: ITEM_H }}
          >
            {item.label}
            {item.id === "copy" ? <CopyIcon /> : <TrashIcon />}
          </button>
        ))}
      </motion.div>
    </div>
  );
}

function CopyIcon() {
  return (
    <svg aria-hidden width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-text-2">
      <rect x="8" y="8" width="12" height="12" rx="2.5" />
      <path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg aria-hidden width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7" />
    </svg>
  );
}
