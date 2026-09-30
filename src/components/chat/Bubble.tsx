"use client";

import { AnimatePresence, motion } from "motion/react";
import type { CSSProperties } from "react";
import type { ReactionSummary } from "@/lib/chat/types";
import { spring } from "@/lib/ui/motion";
import { isJumboEmoji, MessageText } from "./MessageText";

export type BubblePosition = "single" | "first" | "middle" | "last";

/** Corner radii: joined sides of a group get tight corners, the rest stay round. */
export function bubbleRadius(mine: boolean, pos: BubblePosition): string {
  const R = 20;
  const r = 6;
  if (mine) {
    const tr = pos === "middle" || pos === "last" ? r : R;
    return `${R}px ${tr}px ${r}px ${R}px`;
  }
  const bl = pos === "first" || pos === "middle" ? r : R;
  return `${r}px ${R}px ${R}px ${bl}px`;
}

type BubbleBodyProps = {
  body: string;
  deleted: boolean;
  mine: boolean;
  position: BubblePosition;
  className?: string;
  style?: CSSProperties;
};

/**
 * The bubble itself (no behavior): used in the list and, lifted, in the
 * reaction picker. Text is rendered as text nodes only.
 */
export function BubbleBody({ body, deleted, mine, position, className = "", style }: BubbleBodyProps) {
  if (deleted) {
    return (
      <div
        className={`inline-flex items-center gap-1.5 border border-dashed border-hairline-strong px-3.5 py-2 text-[14px] italic text-muted ${className}`}
        style={{ borderRadius: bubbleRadius(mine, position), ...style }}
      >
        <svg aria-hidden width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <circle cx="8" cy="8" r="6" />
          <path d="m3.8 12.2 8.4-8.4" />
        </svg>
        Message deleted
      </div>
    );
  }
  if (isJumboEmoji(body)) {
    return (
      <div
        className={`px-0.5 text-[40px] leading-[1.15] tracking-[0.02em] ${className}`}
        style={{ fontFamily: '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif', ...style }}
      >
        {body}
      </div>
    );
  }
  return (
    <div
      className={`whitespace-pre-wrap break-words px-3.5 py-[9px] text-[15.5px] leading-[1.38] [overflow-wrap:anywhere] ${
        mine
          ? "bg-[linear-gradient(180deg,#363c46_0%,#2c3139_100%)] text-text shadow-[inset_0_0_0_1px_rgb(255_255_255/0.12),inset_0_1px_0_rgb(255_255_255/0.1),0_1px_2px_rgb(0_0_0/0.4)]"
          : "bg-card text-text shadow-[inset_0_0_0_1px_var(--hairline),0_1px_2px_rgb(0_0_0/0.35)]"
      } ${className}`}
      style={{ borderRadius: bubbleRadius(mine, position), ...style }}
    >
      <MessageText text={body} />
    </div>
  );
}

type ReactionChipsProps = {
  reactions: ReactionSummary[];
  mine: boolean;
  onToggle: (emoji: string) => void;
};

/** Emoji + count pills under a bubble; the viewer's own reactions are lit. Tap toggles. */
export function ReactionChips({ reactions, mine, onToggle }: ReactionChipsProps) {
  return (
    <div className={`relative z-[1] -mt-1.5 flex flex-wrap gap-1 px-1.5 ${mine ? "justify-end" : "justify-start"}`}>
      <AnimatePresence initial={false} mode="popLayout">
        {reactions.map((r) => (
          <motion.button
            key={r.emoji}
            type="button"
            layout
            initial={{ opacity: 0, scale: 0.4 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.4, transition: { duration: 0.14 } }}
            transition={spring.bouncy}
            whileTap={{ scale: 0.88 }}
            onClick={() => onToggle(r.emoji)}
            aria-pressed={r.mine}
            aria-label={`${r.emoji} ${r.count}${r.mine ? ", including you" : ""}. Tap to ${r.mine ? "remove" : "add"} yours`}
            className={`flex h-[26px] items-center gap-1 rounded-full pl-1.5 pr-2 text-[13px] leading-none ring-2 ring-bg transition-colors ${
              r.mine
                ? "bg-[#2c323b] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.38)]"
                : "bg-card-elevated shadow-[inset_0_0_0_1px_var(--hairline-strong)]"
            }`}
          >
            <span aria-hidden className="text-[14px]">{r.emoji}</span>
            <motion.span
              key={r.count}
              aria-hidden
              initial={{ y: -6, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={spring.snappy}
              className={`num font-mono text-[11px] font-medium ${r.mine ? "text-text" : "text-text-2"}`}
            >
              {r.count}
            </motion.span>
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  );
}
