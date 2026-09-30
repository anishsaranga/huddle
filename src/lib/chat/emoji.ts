/**
 * The reaction palette. Curated on purpose: a small, fitness-flavored set
 * keeps the picker one glance wide and the server can validate against it.
 * Order = picker order. Adding one is safe; removing one leaves existing
 * reactions in the DB but they can no longer be added (only removed).
 */
export const REACTION_EMOJI = [
  "🔥",
  "💪",
  "👏",
  "❤️",
  "😂",
  "😮",
  "🏆",
  "💯",
  "🙌",
  "🥵",
  "😴",
  "👀",
] as const;

export type ReactionEmoji = (typeof REACTION_EMOJI)[number];

const SET = new Set<string>(REACTION_EMOJI);

export function isReactionEmoji(value: unknown): value is ReactionEmoji {
  return typeof value === "string" && SET.has(value);
}
