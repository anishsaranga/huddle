/**
 * Display formatting for the dashboard (pure, locale-pinned, so server and
 * client render identical text).
 */

import { localParts } from "@/lib/tz";
import { formatNumber } from "@/lib/ui/format";

/** Minutes as "7:12" (hours:minutes). */
export function formatHm(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}

/** Minutes as "7h 12m" / "45m". */
export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`;
}

/** Wall-clock time of instant `ms` in `tz`: "11:42 PM" (12 h) or "23:42". */
export function formatClock(ms: number, tz: string, h12: boolean): string {
  const { hour, minute } = localParts(ms, tz);
  return formatClockMinutes(hour * 60 + minute, h12);
}

/** Minutes after midnight (any integer, wrapped) as a clock time. */
export function formatClockMinutes(minutes: number, h12: boolean): string {
  const t = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h = Math.floor(t / 60);
  const mm = String(t % 60).padStart(2, "0");
  if (!h12) return `${String(h).padStart(2, "0")}:${mm}`;
  return `${h % 12 || 12}:${mm} ${h < 12 ? "AM" : "PM"}`;
}

/** Compact hour label for chart axes: "6P" / "18". */
export function formatAxisHour(hour: number, h12: boolean): string {
  const h = ((hour % 24) + 24) % 24;
  if (!h12) return String(h).padStart(2, "0");
  return `${h % 12 || 12}${h < 12 ? "A" : "P"}`;
}

/** Integer with grouping: "12,480". */
export const formatInt = (n: number): string => formatNumber(Math.round(n), 0);

/**
 * Friendly device name for a Health source string, for sentences like
 * "Your Fitbit doesn't share HRV".
 */
export function deviceName(source: string | null | undefined): string {
  if (!source) return "tracker";
  const s = source.toLowerCase();
  if (s.includes("google") || s.includes("fitbit")) return "Fitbit";
  if (s.includes("zepp") || s.includes("amazfit")) return "Zepp";
  if (s.includes("garmin")) return "Garmin";
  if (s.includes("oura")) return "Oura";
  if (s.includes("watch")) return "Apple Watch";
  if (s.includes("iphone")) return "iPhone";
  return source;
}

/** "a", "a and b", "a, b and c" (or "or"). */
export function joinList(items: string[], conj: "and" | "or" = "and"): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} ${conj} ${items.at(-1)}`;
}
