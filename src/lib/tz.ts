/**
 * Timezone and local-date helpers (Intl only, no dependencies). Server-side
 * ingest uses these to turn instants into the user's local dates and hours,
 * and to read the date formats an iPhone Shortcut produces.
 *
 * Dates are `YYYY-MM-DD` strings; instants are epoch milliseconds.
 */

import { isValidTimezone } from "@/lib/admin/timezones";

export { isValidTimezone };

const DAY_MS = 86_400_000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A syntactically valid `YYYY-MM-DD` that is also a real calendar date. */
export function isRealDate(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1900 || y > 2999) return false;
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

/** `date` plus `n` calendar days (n may be negative). `date` must be real. */
export function addDays(date: string, n: number): string {
  const [y, mo, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (b - a). */
export function daysBetween(a: string, b: string): number {
  const ms = (s: string) => {
    const [y, mo, d] = s.split("-").map(Number);
    return Date.UTC(y, mo - 1, d);
  };
  return Math.round((ms(b) - ms(a)) / DAY_MS);
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(tz, f);
  }
  return f;
}

export type LocalParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

/** Wall-clock fields of instant `ms` in `tz`. */
export function localParts(ms: number, tz: string): LocalParts {
  const out: Record<string, number> = {};
  for (const p of formatterFor(tz).formatToParts(new Date(ms))) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return {
    year: out.year,
    month: out.month,
    day: out.day,
    hour: out.hour === 24 ? 0 : out.hour,
    minute: out.minute,
    second: out.second,
  };
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** Local date (`YYYY-MM-DD`) of instant `ms` in `tz`. */
export function localDateOf(ms: number, tz: string): string {
  const p = localParts(ms, tz);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

/** Local hour (0-23) of instant `ms` in `tz`. */
export function localHourOf(ms: number, tz: string): number {
  return localParts(ms, tz).hour;
}

/** Offset of `tz` from UTC at instant `ms`, in ms (e.g. +2h for CEST). */
export function tzOffsetMs(ms: number, tz: string): number {
  const whole = Math.floor(ms / 1000) * 1000;
  const p = localParts(whole, tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - whole;
}

/**
 * The instant at which the wall clock in `tz` shows the given local time.
 * Nonexistent times (spring-forward gap) resolve to the shifted instant;
 * ambiguous times (fall-back) resolve to one of the two, deterministically.
 */
export function zonedTimeToUtc(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  s: number,
  msPart: number,
  tz: string,
): number {
  const local = Date.UTC(y, mo - 1, d, h, mi, s, msPart);
  const o1 = tzOffsetMs(local, tz);
  let guess = local - o1;
  const o2 = tzOffsetMs(guess, tz);
  if (o2 !== o1) guess = local - o2;
  return guess;
}

/** Today's local date in `tz`. */
export function todayIn(tz: string, now: Date = new Date()): string {
  return localDateOf(now.getTime(), tz);
}

/* ------------------------------------------------------------------------ */
/* Timestamp parsing                                                         */
/* ------------------------------------------------------------------------ */

const ISO_OFFSET_RE =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?\s?(Z|z|[+-]\d{2}(?::?\d{2})?)$/;
const ISO_LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?$/;

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  january: 1, february: 2, march: 3, april: 4, june: 6, july: 7, august: 8, september: 9, october: 10,
  november: 11, december: 12,
};

// "Sep 28, 2026 at 11:42 PM", "September 28, 2026 at 23:42:05", "Sep 28, 2026, 11:42 PM"
const US_RE = /^([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4}),?\s+(?:at\s+)?(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp]\.?[Mm]\.?)?$/;
// "28 Sep 2026 at 23:42", "28 September 2026, 11:42 pm"
const INTL_RE = /^(\d{1,2})\s+([A-Za-z]+)\.?,?\s+(\d{4}),?\s+(?:at\s+)?(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp]\.?[Mm]\.?)?$/;

function fracToMs(frac: string | undefined): number {
  if (!frac) return 0;
  return Math.floor(Number(`0.${frac}`) * 1000);
}

function validClock(h: number, mi: number, s: number): boolean {
  return h >= 0 && h <= 23 && mi >= 0 && mi <= 59 && s >= 0 && s <= 59;
}

function localToUtc(y: number, mo: number, d: number, h: number, mi: number, s: number, ms: number, tz: string): number | null {
  if (!isRealDate(`${pad(y, 4)}-${pad(mo)}-${pad(d)}`) || !validClock(h, mi, s)) return null;
  return zonedTimeToUtc(y, mo, d, h, mi, s, ms, tz);
}

function to24h(h: number, meridiem: string | undefined): number | null {
  if (!meridiem) return h;
  if (h < 1 || h > 12) return null;
  const pm = meridiem[0].toLowerCase() === "p";
  return (h % 12) + (pm ? 12 : 0);
}

/**
 * Parse a timestamp as sent by a Shortcut. Accepted:
 * - ISO 8601 with an offset or `Z` (`2026-09-28T23:42:00+02:00`): exact.
 * - ISO 8601 without an offset (`2026-09-28T23:42:00`): wall-clock time in `tz`.
 * - Shortcuts' English "medium" formats (`Sep 28, 2026 at 11:42 PM`,
 *   `28 Sep 2026 at 23:42`): wall-clock time in `tz`. The narrow no-break
 *   spaces iOS puts before AM/PM are handled.
 * Returns epoch ms, or null when unparseable.
 */
export function parseTimestamp(input: string, tz: string): number | null {
  const s = input.replace(/[   ]/g, " ").replace(/\s+/g, " ").trim();
  if (s.length === 0 || s.length > 64) return null;

  let m = ISO_OFFSET_RE.exec(s);
  if (m) {
    const [y, mo, d, h, mi, sec] = [1, 2, 3, 4, 5, 6].map((i) => Number(m![i] ?? 0));
    if (!isRealDate(`${m[1]}-${m[2]}-${m[3]}`) || !validClock(h, mi, sec)) return null;
    let offsetMin = 0;
    const off = m[8];
    if (off !== "Z" && off !== "z") {
      const sign = off[0] === "-" ? -1 : 1;
      const digits = off.slice(1).replace(":", "");
      const oh = Number(digits.slice(0, 2));
      const om = digits.length > 2 ? Number(digits.slice(2, 4)) : 0;
      if (oh > 14 || om > 59) return null;
      offsetMin = sign * (oh * 60 + om);
    }
    return Date.UTC(y, mo - 1, d, h, mi, sec, fracToMs(m[7])) - offsetMin * 60_000;
  }

  m = ISO_LOCAL_RE.exec(s);
  if (m) {
    const [y, mo, d, h, mi, sec] = [1, 2, 3, 4, 5, 6].map((i) => Number(m![i] ?? 0));
    return localToUtc(y, mo, d, h, mi, sec, fracToMs(m[7]), tz);
  }

  m = US_RE.exec(s);
  if (m) {
    const mo = MONTHS[m[1].toLowerCase()];
    const h = to24h(Number(m[4]), m[7]);
    if (!mo || h === null) return null;
    return localToUtc(Number(m[3]), mo, Number(m[2]), h, Number(m[5]), Number(m[6] ?? 0), 0, tz);
  }

  m = INTL_RE.exec(s);
  if (m) {
    const mo = MONTHS[m[2].toLowerCase()];
    const h = to24h(Number(m[4]), m[7]);
    if (!mo || h === null) return null;
    return localToUtc(Number(m[3]), mo, Number(m[1]), h, Number(m[5]), Number(m[6] ?? 0), 0, tz);
  }

  return null;
}
