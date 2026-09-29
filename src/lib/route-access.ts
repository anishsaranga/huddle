/**
 * Route classification for the proxy's optimistic auth check. Pure, so it
 * can be unit-tested. The authoritative checks live in server layouts
 * (lib/session.ts); this only saves a render for obviously signed-out users.
 */

/** Auth.js session cookie names (plain in dev, `__Secure-` over HTTPS/prod). */
export const SESSION_COOKIE_NAMES = ["authjs.session-token", "__Secure-authjs.session-token"];

const PUBLIC_EXACT = new Set(["/login", "/denied", "/install", "/credits", "/manifest.webmanifest", "/favicon.ico"]);

const PUBLIC_PREFIXES = [
  "/api/auth/", // Auth.js endpoints (sign-in, callback, sign-out)
  "/api/health",
  "/api/ingest", // authenticated by API key, not by session
  "/api/test/", // e2e-only routes; they 404 unless explicitly enabled
  "/icons/",
];

function matchesPrefix(pathname: string, prefix: string): boolean {
  if (prefix.endsWith("/")) return pathname.startsWith(prefix);
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** Paths reachable without a session cookie. */
export function isPublicPath(pathname: string, isDev: boolean): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  if (PUBLIC_PREFIXES.some((p) => matchesPrefix(pathname, p))) return true;
  if (isDev && matchesPrefix(pathname, "/dev")) return true;
  return false;
}

export function hasSessionCookie(cookies: { has(name: string): boolean }): boolean {
  return SESSION_COOKIE_NAMES.some((n) => cookies.has(n));
}
