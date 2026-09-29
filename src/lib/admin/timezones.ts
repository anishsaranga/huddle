/** IANA timezone helpers. Pure (Intl only), so usable on server and client. */

const FALLBACK = "UTC";

/** All selectable timezones, "UTC" first. */
export function listTimezones(): string[] {
  try {
    const zones = Intl.supportedValuesOf("timeZone").filter((z) => z !== FALLBACK);
    return [FALLBACK, ...zones];
  } catch {
    return [FALLBACK];
  }
}

/**
 * True for a real IANA zone name. Accepts aliases the browser may report
 * (e.g. "Asia/Calcutta") but rejects offsets and free text.
 */
export function isValidTimezone(tz: string): boolean {
  if (tz === FALLBACK) return true;
  if (!/^[A-Za-z]+(?:\/[A-Za-z0-9_+-]+)+$/.test(tz)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The browser/runtime timezone, or UTC. */
export function runtimeTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz && isValidTimezone(tz) ? tz : FALLBACK;
  } catch {
    return FALLBACK;
  }
}
