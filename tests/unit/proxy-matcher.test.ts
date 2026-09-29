import { describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ NextResponse: {} }));
const { config } = await import("@/proxy");

// The matcher is a path-to-regexp pattern that is also a plain regex here.
const matches = (path: string) => config.matcher.some((m) => new RegExp(`^${m}$`).test(path));

describe("proxy matcher", () => {
  it("runs on pages and APIs", () => {
    for (const p of ["/", "/home", "/profile", "/api/me/sync-status", "/api/ingestion", "/api/ingest-x"]) {
      expect(matches(p), p).toBe(true);
    }
  });

  it("skips /api/ingest (it streams its own body with a 3 MB cap), Next internals and static files", () => {
    for (const p of ["/api/ingest", "/api/ingest/", "/api/ingest/batch", "/_next/static/x.js", "/icons/icon-192.png"]) {
      expect(matches(p), p).toBe(false);
    }
  });
});
