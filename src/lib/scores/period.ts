/** Leaderboard periods (pure, shared by the queries and client components). */

import { addDays, daysBetween } from "@/lib/tz";

export type BoardPeriod = "day" | "week";

/** Monday of the ISO week containing `date`. */
export function weekStart(date: string): string {
  const dow = (((daysBetween("1970-01-05", date) % 7) + 7) % 7); // 1970-01-05 was a Monday
  return addDays(date, -dow);
}

/** First / last local date of a board for `date`: the date itself, or its Monday-Sunday week. */
export function boardRange(period: BoardPeriod, date: string): { from: string; to: string } {
  const from = period === "day" ? date : weekStart(date);
  return { from, to: period === "day" ? date : addDays(from, 6) };
}
