import { describe, expect, it } from "vitest";
import {
  API_KEY_LENGTH,
  API_KEY_PATTERN,
  authenticateApiKey,
  extractApiKey,
  generateApiKey,
  hashApiKey,
  isWellFormedApiKey,
  prefixHintOf,
  safeEqual,
} from "@/lib/apikey";
import type { Executor } from "@/lib/admin/db";

describe("generateApiKey", () => {
  it("is gk_ + 43 base64url chars (46 total)", () => {
    const key = generateApiKey();
    expect(key).toHaveLength(API_KEY_LENGTH);
    expect(key).toHaveLength(46);
    expect(key.startsWith("gk_")).toBe(true);
    expect(key).toMatch(/^gk_[A-Za-z0-9_-]{43}$/);
    expect(isWellFormedApiKey(key)).toBe(true);
  });

  it("is unique and well formed over 1000 keys", () => {
    const keys = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const k = generateApiKey();
      expect(k).toMatch(API_KEY_PATTERN);
      expect(k).not.toMatch(/[+/=]/);
      keys.add(k);
    }
    expect(keys.size).toBe(1000);
  });

  it("exposes an 8-char display hint including the prefix", () => {
    const key = generateApiKey();
    expect(prefixHintOf(key)).toBe(key.slice(0, 8));
    expect(prefixHintOf(key)).toMatch(/^gk_.{5}$/);
  });
});

describe("hashApiKey", () => {
  const key = "gk_" + "a".repeat(43);

  it("is deterministic hex SHA-256", () => {
    expect(hashApiKey(key, "pepper-1")).toBe(hashApiKey(key, "pepper-1"));
    expect(hashApiKey(key, "pepper-1")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("depends on the pepper and the key", () => {
    expect(hashApiKey(key, "pepper-1")).not.toBe(hashApiKey(key, "pepper-2"));
    expect(hashApiKey(key, "pepper-1")).not.toBe(hashApiKey("gk_" + "b".repeat(43), "pepper-1"));
  });
});

describe("safeEqual", () => {
  it("compares strings", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});

describe("extractApiKey", () => {
  const key = "gk_" + "k".repeat(43);
  const other = "gk_" + "q".repeat(43);
  const req = (url: string, headers: Record<string, string> = {}) => new Request(`http://localhost${url}`, { headers });

  it("reads a Bearer header", () => {
    expect(extractApiKey(req("/x", { authorization: `Bearer ${key}` }))).toEqual({ key, method: "bearer" });
  });

  it("accepts any casing of the scheme and extra whitespace", () => {
    expect(extractApiKey(req("/x", { authorization: `bearer ${key}` }))).toEqual({ key, method: "bearer" });
    expect(extractApiKey(req("/x", { authorization: `BEARER   ${key}  ` }))).toEqual({ key, method: "bearer" });
  });

  it("falls back to ?key=", () => {
    expect(extractApiKey(req(`/x?key=${key}`))).toEqual({ key, method: "query" });
  });

  it("returns null when neither is present (or the header isn't Bearer)", () => {
    expect(extractApiKey(req("/x"))).toBeNull();
    expect(extractApiKey(req("/x?key="))).toBeNull();
    expect(extractApiKey(req("/x", { authorization: "Basic abc" }))).toBeNull();
    expect(extractApiKey(req("/x", { authorization: "Bearer" }))).toBeNull();
  });

  it("prefers the header when both are present", () => {
    expect(extractApiKey(req(`/x?key=${other}`, { authorization: `Bearer ${key}` }))).toEqual({ key, method: "bearer" });
  });
});

describe("authenticateApiKey format pre-check", () => {
  const explode = () => {
    throw new Error("DB must not be touched for malformed keys");
  };
  const noDb = { select: explode, insert: explode, update: explode, delete: explode } as unknown as Executor;

  it("rejects junk without a DB hit", async () => {
    for (const junk of [
      null,
      undefined,
      "",
      "gk_",
      "gk_short",
      "xx_" + "a".repeat(43),
      "gk_" + "a".repeat(42),
      "gk_" + "a".repeat(44),
      "gk_" + "a".repeat(42) + "=",
      "gk_" + "a".repeat(42) + "/",
      " gk_" + "a".repeat(43),
      "' or 1=1 --",
    ]) {
      await expect(authenticateApiKey(noDb, junk)).resolves.toBeNull();
    }
  });
});
