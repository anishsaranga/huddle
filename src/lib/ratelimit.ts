/**
 * In-memory sliding-window rate limiting (sliding log). Single-instance only:
 * each server process has its own counters, and they reset on restart. That
 * matches the deployment (one `web` container); see the design doc.
 */

export type RateLimitResult =
  | { ok: true; remaining: number }
  | { ok: false; retryAfterSec: number };

export type SlidingWindowOptions = {
  /** Requests allowed per window. */
  limit: number;
  windowMs: number;
  /** Most keys tracked at once; the least recently used are evicted beyond this. */
  maxKeys?: number;
};

export class SlidingWindowLimiter {
  readonly limit: number;
  readonly windowMs: number;
  readonly maxKeys: number;
  /** key -> accepted request times (ascending). Map order = least recently used first. */
  private hits = new Map<string, number[]>();

  constructor(opts: SlidingWindowOptions) {
    if (opts.limit < 1 || opts.windowMs <= 0) throw new Error("invalid rate limit options");
    this.limit = opts.limit;
    this.windowMs = opts.windowMs;
    this.maxKeys = opts.maxKeys ?? 10_000;
  }

  /**
   * Count a request for `key` if it is within the limit. Rejected requests
   * are not recorded, so a client that keeps hammering is unblocked as soon
   * as its oldest accepted request leaves the window.
   */
  hit(key: string, now: number = Date.now()): RateLimitResult {
    const cutoff = now - this.windowMs;
    let times = this.hits.get(key);
    if (times) {
      let drop = 0;
      while (drop < times.length && times[drop] <= cutoff) drop++;
      if (drop) times = times.slice(drop);
      this.hits.delete(key); // re-inserted below: moves the key to most-recently-used
    } else {
      times = [];
    }

    if (times.length >= this.limit) {
      this.hits.set(key, times);
      const retryAfterMs = times[0] + this.windowMs - now;
      return { ok: false, retryAfterSec: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
    }

    times.push(now);
    this.hits.set(key, times);
    this.evict(cutoff);
    return { ok: true, remaining: this.limit - times.length };
  }

  /** Number of keys currently tracked (tests / diagnostics). */
  get size(): number {
    return this.hits.size;
  }

  reset(): void {
    this.hits.clear();
  }

  private evict(cutoff: number): void {
    if (this.hits.size <= this.maxKeys) return;
    // First drop keys whose whole history has expired, then least recently used ones.
    for (const [k, times] of this.hits) {
      if (this.hits.size <= this.maxKeys) return;
      if (times.length === 0 || times[times.length - 1] <= cutoff) this.hits.delete(k);
    }
    for (const k of this.hits.keys()) {
      if (this.hits.size <= this.maxKeys) return;
      this.hits.delete(k);
    }
  }
}

/* ------------------------------------------------------------------------ */
/* Ingest limiters                                                           */
/* ------------------------------------------------------------------------ */

export const INGEST_RATE_LIMIT = 60;
export const INGEST_RATE_WINDOW_MS = 60 * 60 * 1000;

export type IngestLimiters = { ip: SlidingWindowLimiter; key: SlidingWindowLimiter };

const globalForLimits = globalThis as unknown as { __huddleIngestLimiters?: IngestLimiters };

/** The process-wide ingest limiters (cached on globalThis so dev HMR keeps the counts). */
export function getIngestLimiters(): IngestLimiters {
  if (!globalForLimits.__huddleIngestLimiters) {
    globalForLimits.__huddleIngestLimiters = {
      ip: new SlidingWindowLimiter({ limit: INGEST_RATE_LIMIT, windowMs: INGEST_RATE_WINDOW_MS }),
      key: new SlidingWindowLimiter({ limit: INGEST_RATE_LIMIT, windowMs: INGEST_RATE_WINDOW_MS }),
    };
  }
  return globalForLimits.__huddleIngestLimiters;
}

/** Clear all ingest counters (tests). */
export function resetIngestLimiters(): void {
  const l = getIngestLimiters();
  l.ip.reset();
  l.key.reset();
}

/**
 * Client IP as seen through the Cloudflare tunnel: `CF-Connecting-IP`, else
 * the first `X-Forwarded-For` entry, else "unknown". Only trustworthy behind
 * the tunnel (the app port must not be exposed directly).
 */
export function clientIp(headers: { get(name: string): string | null }): string {
  const clean = (v: string | null | undefined) => {
    const s = (v ?? "").trim();
    return s && s.length <= 64 && /^[0-9A-Za-z:.%_-]+$/.test(s) ? s : null;
  };
  return (
    clean(headers.get("cf-connecting-ip")) ??
    clean(headers.get("x-forwarded-for")?.split(",")[0]) ??
    "unknown"
  );
}
