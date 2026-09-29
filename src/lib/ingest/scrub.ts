/**
 * Make a parsed body safe to store and log: fields named like credentials are
 * replaced, as is the request's own API key or anything key-shaped inside
 * any string (in case a Shortcut put it in the body). Very deep nesting is cut off so storing and
 * logging can't blow the stack.
 */

export const REDACTED = "[REDACTED]";
const SECRET_KEYS = new Set(["key", "api_key", "apikey", "authorization", "token", "password"]);
export const MAX_SCRUB_DEPTH = 32;

/** Anything shaped like a Huddle API key (or a long-enough piece of one). */
const KEY_LIKE_RE = /gk_[A-Za-z0-9_-]{16,}/g;

export function scrubString(value: string, secret?: string): string {
  let out = secret && value.includes(secret) ? value.split(secret).join(REDACTED) : value;
  if (out.includes("gk_")) out = out.replace(KEY_LIKE_RE, REDACTED);
  return out;
}

/**
 * Deep copy of `value` (as plain objects and arrays) with secrets removed. `redactNames`: also replace the
 * values of credential-named fields (`key`, `api_key`, `token`, ...).
 */
export function scrubSecrets(value: unknown, secret?: string, redactNames = true, depth = 0): unknown {
  if (typeof value === "string") return scrubString(value, secret);
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_SCRUB_DEPTH) return "[TOO DEEP]";
  if (Array.isArray(value)) return value.map((v) => scrubSecrets(v, secret, redactNames, depth + 1));
  // A plain object (drizzle and friends expect one), with every key an own
  // data property, so a "__proto__" key stays a key.
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    const clean =
      redactNames && SECRET_KEYS.has(k.toLowerCase().replace(/-/g, "_"))
        ? REDACTED
        : scrubSecrets(v, secret, redactNames, depth + 1);
    Object.defineProperty(out, scrubString(k, secret), { value: clean, enumerable: true, writable: true, configurable: true });
  }
  return out;
}
