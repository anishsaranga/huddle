import { describe, expect, it } from "vitest";
import { hasSessionCookie, isPublicPath } from "@/lib/route-access";

describe("isPublicPath", () => {
  it("lets auth pages, public APIs and static assets through", () => {
    for (const p of [
      "/login",
      "/denied",
      "/install",
      "/credits",
      "/api/auth/signin/google",
      "/api/auth/callback/google",
      "/api/health",
      "/api/ingest",
      "/api/ingest/batch",
      "/api/test/login",
      "/manifest.webmanifest",
      "/icons/icon-192.png",
    ]) {
      expect(isPublicPath(p, false), p).toBe(true);
    }
  });

  it("protects app pages and other APIs", () => {
    for (const p of [
      "/",
      "/home",
      "/groups",
      "/profile",
      "/onboarding",
      "/admin",
      "/api/me",
      "/api/avatar/00000000-0000-4000-8000-000000000000",
      "/api/healthz",
      "/api/ingestion",
      "/login-x",
    ]) {
      expect(isPublicPath(p, false), p).toBe(false);
    }
  });

  it("opens /dev/* only in development", () => {
    expect(isPublicPath("/dev/ui", true)).toBe(true);
    expect(isPublicPath("/dev/ui", false)).toBe(false);
    expect(isPublicPath("/devices", true)).toBe(false);
  });
});

describe("hasSessionCookie", () => {
  const jar = (...names: string[]) => ({ has: (n: string) => names.includes(n) });

  it("recognizes both the plain and the __Secure- session cookie", () => {
    expect(hasSessionCookie(jar("authjs.session-token"))).toBe(true);
    expect(hasSessionCookie(jar("__Secure-authjs.session-token"))).toBe(true);
    expect(hasSessionCookie(jar("authjs.csrf-token"))).toBe(false);
  });
});
