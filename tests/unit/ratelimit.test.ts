import { describe, expect, it } from "vitest";
import { clientIp, SlidingWindowLimiter } from "@/lib/ratelimit";

const HOUR = 3_600_000;

describe("SlidingWindowLimiter", () => {
  it("allows `limit` requests per sliding window, then answers Retry-After", () => {
    const l = new SlidingWindowLimiter({ limit: 3, windowMs: HOUR });
    const t0 = 1_000_000;
    expect(l.hit("a", t0)).toEqual({ ok: true, remaining: 2 });
    expect(l.hit("a", t0 + 10_000)).toEqual({ ok: true, remaining: 1 });
    expect(l.hit("a", t0 + 20_000)).toEqual({ ok: true, remaining: 0 });
    expect(l.hit("a", t0 + 30_000)).toEqual({ ok: false, retryAfterSec: 3570 });
    // Other keys are independent.
    expect(l.hit("b", t0 + 30_000).ok).toBe(true);
    // Rejections aren't counted: once the first hit leaves the window, one slot opens.
    expect(l.hit("a", t0 + HOUR).ok).toBe(true);
    expect(l.hit("a", t0 + HOUR + 1)).toEqual({ ok: false, retryAfterSec: 10 });
  });

  it("caps the number of tracked keys, evicting expired then least recently used", () => {
    const l = new SlidingWindowLimiter({ limit: 1, windowMs: HOUR, maxKeys: 3 });
    l.hit("old", 0);
    l.hit("a", HOUR + 1);
    l.hit("b", HOUR + 2);
    l.hit("c", HOUR + 3); // "old" expired: evicted first
    expect(l.size).toBe(3);
    expect(l.hit("a", HOUR + 4).ok).toBe(false); // still tracked, and now most recently used
    l.hit("d", HOUR + 5); // evicts "b" (least recently used)
    expect(l.size).toBe(3);
    expect(l.hit("b", HOUR + 6).ok).toBe(true);
    l.reset();
    expect(l.size).toBe(0);
  });
});

describe("clientIp", () => {
  const h = (init: Record<string, string>) => new Headers(init);
  it("prefers CF-Connecting-IP, then the first X-Forwarded-For hop", () => {
    expect(clientIp(h({ "cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "10.0.0.1" }))).toBe("203.0.113.7");
    expect(clientIp(h({ "x-forwarded-for": " 198.51.100.2 , 10.0.0.1" }))).toBe("198.51.100.2");
    expect(clientIp(h({ "x-forwarded-for": "2001:db8::1" }))).toBe("2001:db8::1");
    expect(clientIp(h({}))).toBe("unknown");
    expect(clientIp(h({ "cf-connecting-ip": "<script>" }))).toBe("unknown");
  });
});
