"use client";

import { motion } from "motion/react";
import { memo } from "react";
import { useFlairProps } from "@/components/champions/Flair";
import { Avatar } from "@/components/ui/Avatar";
import type { ChatAuthor } from "@/lib/chat/types";
import { timeLabel, type TimelineItem } from "@/lib/chat/timeline";
import { spring } from "@/lib/ui/motion";
import { BubbleBody, ReactionChips, type BubblePosition } from "./Bubble";
import { ChampionsCard, SystemCard } from "./Cards";
import type { ClientMessage } from "./store";
import { useLongPress } from "./useLongPress";

export type TimelineMessage = ClientMessage;

export type ListHandlers = {
  onMenu: (message: TimelineMessage, el: HTMLElement, position: BubblePosition) => void;
  onReact: (message: TimelineMessage, emoji: string) => void;
  onRetry: (message: TimelineMessage) => void;
  onDiscard: (message: TimelineMessage) => void;
};

type MessageListProps = ListHandlers & {
  items: TimelineItem<TimelineMessage>[];
  viewerId: string;
  tz: string;
};

export function authorName(a: ChatAuthor | null): string {
  if (!a) return "Deleted user";
  return a.displayName?.trim() || a.username || "Member";
}

const positionOf = (i: number, n: number): BubblePosition =>
  n === 1 ? "single" : i === 0 ? "first" : i === n - 1 ? "last" : "middle";

export function MessageList({ items, viewerId, tz, ...handlers }: MessageListProps) {
  return (
    <div className="flex flex-col">
      {items.map((item) =>
        item.type === "day" ? (
          <DaySeparator key={item.key} label={item.label} />
        ) : item.type === "card" ? (
          <CardRow key={item.key} message={item.message} tz={tz} />
        ) : (
          <MessageGroup key={item.key} messages={item.messages} viewerId={viewerId} tz={tz} {...handlers} />
        ),
      )}
    </div>
  );
}

/** Neutral stand-in for an author whose account was deleted (messages.user_id is null). */
function DeletedUserAvatar() {
  return (
    <span
      aria-hidden
      className="grid size-7 place-items-center rounded-full bg-card-sunken text-dim shadow-[inset_0_0_0_1px_var(--hairline-strong)]"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <circle cx="12" cy="8.5" r="3.6" />
        <path d="M4.5 20c.6-3.9 3.7-6 7.5-6s6.9 2.1 7.5 6" />
      </svg>
    </span>
  );
}

function DaySeparator({ label }: { label: string }) {
  return (
    <div role="separator" aria-label={label} className="flex items-center gap-3 px-2 pb-3 pt-5">
      <span aria-hidden className="h-px flex-1 bg-[linear-gradient(90deg,transparent,var(--hairline-strong))]" />
      <span className="telemetry text-[10px] tracking-[0.16em]">{label}</span>
      <span aria-hidden className="h-px flex-1 bg-[linear-gradient(270deg,transparent,var(--hairline-strong))]" />
    </div>
  );
}

function CardRow({ message, tz }: { message: TimelineMessage; tz: string }) {
  const time = timeLabel(message.at, tz);
  return (
    <motion.div
      data-message-id={message.id}
      className="py-2"
      // The champions card plays its own entrance.
      initial={message.fresh && message.kind !== "champions" ? { opacity: 0, y: 16, scale: 0.98 } : false}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={spring.soft}
    >
      {message.kind === "champions" ? (
        <ChampionsCard body={message.body} payload={message.payload} time={time} />
      ) : (
        <SystemCard body={message.body} payload={message.payload} time={time} />
      )}
    </motion.div>
  );
}

type GroupProps = ListHandlers & { messages: TimelineMessage[]; viewerId: string; tz: string };

const MessageGroup = memo(function MessageGroup({ messages, viewerId, tz, ...handlers }: GroupProps) {
  const first = messages[0];
  const last = messages[messages.length - 1];
  const mine = first.authorId === viewerId;
  const name = authorName(first.author);
  const flair = useFlairProps(first.author?.id, { size: 13 });

  return (
    <div className={`flex gap-2 pt-2.5 ${mine ? "justify-end pl-10" : "pr-8"}`}>
      {!mine && (
        <div className="w-7 shrink-0 pt-[19px]">
          {first.author ? (
            <Avatar user={first.author} label={name} size="sm" ring={flair.ring} badge={flair.badge} />
          ) : (
            <DeletedUserAvatar />
          )}
        </div>
      )}
      <div className={`flex min-w-0 flex-1 flex-col ${mine ? "items-end" : "items-start"}`}>
        {!mine && (
          <div className="mb-1 flex items-baseline gap-2 pl-1">
            <span className={`text-[12.5px] font-semibold ${first.author ? "text-text-2" : "italic text-muted"}`}>{name}</span>
            <span className="telemetry text-[9.5px] text-dim">{timeLabel(first.at, tz)}</span>
          </div>
        )}
        {messages.map((m, i) => (
          <MessageRow key={m.key} message={m} mine={mine} position={positionOf(i, messages.length)} {...handlers} />
        ))}
        {mine && last.status === "sent" && (
          <span className="telemetry mt-1 pr-1 text-[9.5px] text-dim">{timeLabel(last.at, tz)}</span>
        )}
      </div>
    </div>
  );
});

type RowProps = ListHandlers & { message: TimelineMessage; mine: boolean; position: BubblePosition };

const MessageRow = memo(function MessageRow({ message, mine, position, onMenu, onReact, onRetry, onDiscard }: RowProps) {
  const canMenu = message.status === "sent" && !message.deleted;
  const press = useLongPress((el) => onMenu(message, el, position), canMenu);
  const gap = position === "first" || position === "single" ? "" : "mt-[3px]";

  return (
    <motion.div
      data-message-id={message.status === "sent" ? message.id : undefined}
      className={`flex max-w-[82%] flex-col ${mine ? "items-end" : "items-start"} ${gap}`}
      style={{ transformOrigin: mine ? "100% 100%" : "0% 100%" }}
      initial={message.fresh ? { opacity: 0, y: 14, scale: 0.94 } : false}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={spring.soft}
    >
      <div
        {...press}
        tabIndex={canMenu ? 0 : undefined}
        aria-haspopup={canMenu ? "menu" : undefined}
        onKeyDown={(e) => {
          if (!canMenu) return;
          if (e.key === "Enter" || e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
            e.preventDefault();
            onMenu(message, e.currentTarget, position);
          }
        }}
        data-testid="chat-bubble"
        className={`nav-chrome rounded-[20px] outline-offset-2 transition-opacity duration-300 ${
          message.status === "sending" ? "opacity-60" : "opacity-100"
        }`}
      >
        <BubbleBody body={message.body} deleted={message.deleted} mine={mine} position={position} />
      </div>
      {message.reactions.length > 0 && !message.deleted && (
        <ReactionChips reactions={message.reactions} mine={mine} onToggle={(emoji) => onReact(message, emoji)} />
      )}
      {message.status === "sending" && (
        <span className="telemetry mt-1 pr-1 text-[9.5px] text-dim" aria-live="polite">
          SENDING…
        </span>
      )}
      {message.status === "failed" && (
        <span className="mt-1 flex items-center gap-2 pr-1" role="alert">
          <span className="telemetry text-[9.5px] text-recovery-red">NOT SENT</span>
          <button type="button" onClick={() => onRetry(message)} className="telemetry text-[9.5px] text-text underline underline-offset-2">
            RETRY
          </button>
          <button type="button" onClick={() => onDiscard(message)} className="telemetry text-[9.5px] text-muted underline underline-offset-2">
            DISCARD
          </button>
        </span>
      )}
    </motion.div>
  );
});
