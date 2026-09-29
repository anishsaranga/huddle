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
