/**
 * Guard for the e2e-only login bypass (`POST /api/test/login`).
 * Enabled only when BOTH hold:
 *   - NODE_ENV is not "production" (Next inlines NODE_ENV at build time, so
 *     in a production build this is a compile-time `false`), and
 *   - E2E_AUTH is exactly "1" at runtime.
 */
export function isTestAuthEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.NODE_ENV !== "production" && env.E2E_AUTH === "1";
}

/** Only accept bypass requests addressed to the local machine. */
export function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}
