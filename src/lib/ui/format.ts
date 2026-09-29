const cache = new Map<number, Intl.NumberFormat>();

/** Locale-pinned number format so server and client render identically. */
export function formatNumber(value: number, decimals = 0): string {
  let fmt = cache.get(decimals);
  if (!fmt) {
    fmt = new Intl.NumberFormat("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    cache.set(decimals, fmt);
  }
  return fmt.format(value);
}

const shortDate = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** "28 Sep 2026". Locale- and timezone-pinned so server and client render identically. */
export function formatShortDate(date: Date): string {
  return shortDate.format(date);
}

const monthYear = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

/** "Sep 2026". Locale- and timezone-pinned like formatShortDate. */
export function formatMonthYear(date: Date): string {
  return monthYear.format(date);
}

/** "Just now", "5 min ago", "3 h ago", "2 days ago", then a short date. */
export function formatRelative(date: Date, now: Date = new Date()): string {
  const s = Math.max(0, Math.round((now.getTime() - date.getTime()) / 1000));
  if (s < 60) return "Just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return d === 1 ? "Yesterday" : `${d} days ago`;
  return formatShortDate(date);
}
