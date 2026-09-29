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
