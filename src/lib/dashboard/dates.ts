/**
 * Date handling for the personal dashboard (Home and the detail screens). Pure:
 * every function takes "today" (the user's local date) instead of reading a
 * clock, so server and client agree and tests are deterministic.
 *
 * Dates are local `YYYY-MM-DD` strings.
 */

import { addDays, daysBetween, isRealDate, localParts } from "@/lib/tz";

const WEEKDAYS = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** 0 = Sunday. */
export function dayOfWeek(date: string): number {
  return (((daysBetween("1970-01-04", date) % 7) + 7) % 7); // 1970-01-04 was a Sunday
}

/**
 * The date a dashboard screen shows for `?date=`: a real `YYYY-MM-DD` clamped
 * to [first data date, today]; anything else (missing, malformed, repeated)
 * means today. Without data the range is just today.
 */
export function resolveDashboardDate(
  requested: string | string[] | undefined | null,
  today: string,
  firstDate: string | null,
): string {
  const raw = Array.isArray(requested) ? requested[0] : requested;
  if (!raw || !isRealDate(raw)) return today;
  const lo = firstDate && firstDate < today ? firstDate : today;
  if (raw < lo) return lo;
  if (raw > today) return today;
  return raw;
}

/** Neighbouring dates inside [first data date, today] (null at either end). */
export function dayNav(date: string, today: string, firstDate: string | null): { prev: string | null; next: string | null } {
  const lo = firstDate && firstDate < today ? firstDate : today;
  return { prev: date > lo ? addDays(date, -1) : null, next: date < today ? addDays(date, 1) : null };
}

/** "TODAY", "YESTERDAY", a weekday within the last week, else "SEP 14". */
export function dayTitle(date: string, today: string): string {
  const ago = daysBetween(date, today);
  if (ago === 0) return "TODAY";
  if (ago === 1) return "YESTERDAY";
  if (ago > 1 && ago < 7) return WEEKDAYS[dayOfWeek(date)];
  return shortDate(date);
}

/** "SEP 28". */
export function shortDate(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

/** "MON". */
export function weekdayShort(date: string): string {
  return WEEKDAYS[dayOfWeek(date)].slice(0, 3);
}

/** "MON · SEP 28" (plus the year when it isn't `today`'s year). */
export function dateLabel(date: string, today: string): string {
  const year = date.slice(0, 4);
  return `${weekdayShort(date)} · ${shortDate(date)}${year !== today.slice(0, 4) ? ` ${year}` : ""}`;
}

/** Month name for the calendar header: "SEPTEMBER 2026". */
export function monthTitle(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const names = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];
  return `${names[m - 1]} ${y}`;
}

/** `path?date=…`, or the bare path for today (so "today" URLs stay canonical). */
export function dateHref(path: string, date: string, today: string): string {
  return date === today ? path : `${path}?date=${date}`;
}

/**
 * Hour (0-23) of "now" in `tz` when `date` is today, else null. Hours after
 * it haven't happened yet (partial day).
 */
export function currentHourFor(date: string, today: string, tz: string, now: Date): number | null {
  return date === today ? localParts(now.getTime(), tz).hour : null;
}

/**
 * Month grid for the calendar sheet: weeks (Mon-Sun) covering `month`
 * (`YYYY-MM`), with null for padding cells.
 */
export function monthGrid(month: string): (string | null)[][] {
  const first = `${month}-01`;
  const lead = (dayOfWeek(first) + 6) % 7; // Monday-first
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let d = first; d.startsWith(month); d = addDays(d, 1)) cells.push(d);
  while (cells.length % 7) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** `YYYY-MM` shifted by `n` months. */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${String(Math.floor(t / 12)).padStart(4, "0")}-${String((t % 12) + 1).padStart(2, "0")}`;
}

/**
 * Line under the Home title: the full date ("MON · SEP 28"), or, when the
 * title already is the date (older than a week), the weekday ("SUNDAY").
 */
export function daySubtitle(date: string, today: string): string {
  const ago = daysBetween(date, today);
  if (ago >= 7) {
    const year = date.slice(0, 4);
    return `${WEEKDAYS[dayOfWeek(date)]}${year !== today.slice(0, 4) ? ` · ${year}` : ""}`;
  }
  return dateLabel(date, today);
}
