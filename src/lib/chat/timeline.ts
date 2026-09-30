/**
 * Chat timeline layout (pure): day separators and author groups.
 *
 * - A new day (in the viewer's timezone) starts with a separator: "TODAY",
 *   "YESTERDAY", else "MON · SEP 28" (plus the year when it isn't this year).
 * - Consecutive text messages from the same author form a group; a gap of
 *   5 minutes or more, another author, a day change or a card breaks it.
 * - `system` / `champions` posts are full-width cards, never grouped.
 *
 * Everything takes `tz` and `today` explicitly so server and client render the
 * same labels.
 */

import type { MessageKind } from "@/db/schema";
import { dateLabel } from "@/lib/dashboard/dates";
import { daysBetween, localDateOf, localParts } from "@/lib/tz";

export const GROUP_GAP_MS = 5 * 60_000;

export type TimelineInput = {
  /** Stable React key (message id, or a client id while pending). */
  key: string;
  authorId: string | null;
  kind: MessageKind;
  /** Epoch ms. */
  at: number;
};

export type TimelineItem<T extends TimelineInput> =
  | { type: "day"; key: string; date: string; label: string }
  | { type: "group"; key: string; authorId: string | null; messages: T[] }
  | { type: "card"; key: string; message: T };

export function dayLabel(date: string, today: string): string {
  const ago = daysBetween(date, today);
  if (ago === 0) return "TODAY";
  if (ago === 1) return "YESTERDAY";
  return dateLabel(date, today);
}

/** "7:42 AM" in `tz`. */
export function timeLabel(ms: number, tz: string): string {
  const { hour, minute } = localParts(ms, tz);
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
}

export function buildTimeline<T extends TimelineInput>(messages: readonly T[], tz: string, today: string): TimelineItem<T>[] {
  const items: TimelineItem<T>[] = [];
  let day: string | null = null;
  let group: Extract<TimelineItem<T>, { type: "group" }> | null = null;
  let prev: T | null = null;

  for (const m of messages) {
    const date = localDateOf(m.at, tz);
    if (date !== day) {
      day = date;
      group = null;
      items.push({ type: "day", key: `day-${date}`, date, label: dayLabel(date, today) });
    }
    if (m.kind !== "text") {
      group = null;
      items.push({ type: "card", key: m.key, message: m });
    } else if (group && prev && prev.kind === "text" && prev.authorId === m.authorId && m.at - prev.at < GROUP_GAP_MS) {
      group.messages.push(m);
    } else {
      group = { type: "group", key: `g-${m.key}`, authorId: m.authorId, messages: [m] };
      items.push(group);
    }
    prev = m;
  }
  return items;
}
