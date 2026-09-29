import type { TodayScores } from "@/lib/groups/view";
import type { BoardMember } from "@/lib/scores/queries";

/** A member as the Info tab shows them (serializable; all time formatting done on the server). */
export type MemberView = BoardMember & {
  timezone: string;
  scores: TodayScores;
  syncedToday: boolean;
  /** "3 h ago" / null = never synced. */
  lastSynced: string | null;
  /** The member's own today, e.g. "TUE · SEP 29". */
  todayLabel: string;
};

export type GroupTrendBar = { label: string; title: string; value: number | null; color?: string };
