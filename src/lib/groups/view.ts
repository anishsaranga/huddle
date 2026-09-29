/**
 * Pure view helpers for the Community tab: today averages, the group page's
 * URL state (`?tab=&period=&date=`) and leaderboard date navigation. No clock
 * reads: callers pass the group's date (today in the group's timezone) as
 * "today", which also bounds date navigation.
 */

import { dayTitle, dateLabel, shortDate } from "@/lib/dashboard/dates";
import { boardRange, type BoardPeriod } from "@/lib/scores/period";
import { addDays, isRealDate } from "@/lib/tz";

export type TodayScores = { recovery: number | null; strain: number | null; sleep: number | null };

/** Mean of a score across members with a value (1 decimal), and how many had one. */
export type GroupAverage = { value: number | null; n: number };

export type GroupToday = {
  recovery: GroupAverage;
  strain: GroupAverage;
  sleep: GroupAverage;
  /** Members with data (a daily_metrics or daily_scores row) for the group date. */
  synced: number;
  total: number;
};

const avg = (vs: (number | null)[]): GroupAverage => {
  const xs = vs.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (xs.length === 0) return { value: null, n: 0 };
  return { value: Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10, n: xs.length };
};

export function groupToday(members: readonly { scores: TodayScores; hasData: boolean }[]): GroupToday {
  return {
    recovery: avg(members.map((m) => m.scores.recovery)),
    strain: avg(members.map((m) => m.scores.strain)),
    sleep: avg(members.map((m) => m.scores.sleep)),
    synced: members.filter((m) => m.hasData).length,
    total: members.length,
  };
}

/* ------------------------------------------------------------------------ */
/* Group page URL state                                                      */
/* ------------------------------------------------------------------------ */

export const GROUP_TABS = ["info", "chat", "strain", "recovery", "sleep"] as const;
export type GroupTab = (typeof GROUP_TABS)[number];

export type GroupPageState = { tab: GroupTab; period: BoardPeriod; date: string };

const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/**
 * `?tab=strain&period=week&date=2026-09-22` → state. Unknown tabs mean Info,
 * anything but `week` means Day, and the date is clamped to [first data date,
 * today] (missing / malformed = today), where `today` is the group date.
 */
export function parseGroupState(
  sp: Record<string, string | string[] | undefined>,
  today: string,
  firstDate: string | null,
): GroupPageState {
  const rawTab = first(sp.tab);
  const tab = (GROUP_TABS as readonly string[]).includes(rawTab ?? "") ? (rawTab as GroupTab) : "info";
  const period: BoardPeriod = first(sp.period) === "week" ? "week" : "day";
  const raw = first(sp.date);
  let date = raw && isRealDate(raw) ? raw : today;
  if (date > today) date = today;
  const lo = firstDate && firstDate < today ? firstDate : today;
  if (date < lo) date = lo;
  return { tab, period, date };
}

/** Canonical query string for a state (defaults omitted: Info, Day, today). "" when all default. */
export function groupQuery(state: GroupPageState, today: string): string {
  const p = new URLSearchParams();
  if (state.tab !== "info") p.set("tab", state.tab);
  if (state.period === "week") p.set("period", "week");
  if (state.date !== today) p.set("date", state.date);
  const s = p.toString();
  return s ? `?${s}` : "";
}

export type BoardNav = {
  /** Big line: "TODAY", "YESTERDAY", "THIS WEEK", "LAST WEEK", "SEP 14", "SEP 14 – 20". */
  title: string;
  /** Mono line: "TUE · SEP 29" or "SEP 22 – SEP 28". */
  sub: string;
  /** Date to go to for ‹ / › (null = disabled). */
  prev: string | null;
  next: string | null;
};

/** "SEP 22 – SEP 28" (week range, both ends labelled). */
export function weekRangeLabel(from: string, to: string): string {
  return `${shortDate(from)} – ${shortDate(to)}`;
}

/**
 * Title, subtitle and neighbours for the leaderboard date switcher. Days step
 * by one, weeks by seven (landing on the same weekday, clamped to today);
 * nothing after today or before the week / day holding the first data date.
 */
export function boardNav(period: BoardPeriod, date: string, today: string, firstDate: string | null): BoardNav {
  const lo = firstDate && firstDate < today ? firstDate : today;
  if (period === "day") {
    return {
      title: dayTitle(date, today),
      sub: dateLabel(date, today),
      prev: date > lo ? addDays(date, -1) : null,
      next: date < today ? addDays(date, 1) : null,
    };
  }
  const { from, to } = boardRange("week", date);
  const thisWeek = boardRange("week", today).from;
  const loWeek = boardRange("week", lo).from;
  const weeksAgo = Math.round((Date.parse(thisWeek) - Date.parse(from)) / (7 * 86_400_000));
  const [fm, fd] = shortDate(from).split(" ");
  const [tm, td] = shortDate(to).split(" ");
  const compact = fm === tm ? `${fm} ${fd} – ${td}` : `${fm} ${fd} – ${tm} ${td}`;
  const next = addDays(date, 7);
  return {
    title: weeksAgo === 0 ? "THIS WEEK" : weeksAgo === 1 ? "LAST WEEK" : compact,
    sub: weekRangeLabel(from, to),
    prev: from > loWeek ? (addDays(date, -7) < lo ? addDays(from, -1) : addDays(date, -7)) : null,
    next: from < thisWeek ? (next > today ? today : next) : null,
  };
}

/** "TODAY · SEP 29 · EUROPE/BERLIN": the group's date and timezone, for the Info tab. */
export function groupDateContext(date: string, timezone: string): string {
  return `TODAY · ${shortDate(date)} · ${timezone.toUpperCase()}`;
}
