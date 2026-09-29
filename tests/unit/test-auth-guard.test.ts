import { afterEach, describe, expect, it, vi } from "vitest";
import { isLoopbackHost, isTestAuthEnabled } from "@/lib/test-auth";

describe("isTestAuthEnabled", () => {
  it("is off in production even with E2E_AUTH=1", () => {
    expect(isTestAuthEnabled({ NODE_ENV: "production", E2E_AUTH: "1" })).toBe(false);
  });

  it("is off unless E2E_AUTH is exactly '1'", () => {
    for (const E2E_AUTH of [undefined, "", "0", "true", "yes", " 1"]) {
      expect(isTestAuthEnabled({ NODE_ENV: "development", E2E_AUTH })).toBe(false);
    }
  });

  it("is on only for non-production with E2E_AUTH=1", () => {
    expect(isTestAuthEnabled({ NODE_ENV: "development", E2E_AUTH: "1" })).toBe(true);
    expect(isTestAuthEnabled({ NODE_ENV: "test", E2E_AUTH: "1" })).toBe(true);
  });
});

describe("isLoopbackHost", () => {
  it("accepts only loopback names", () => {
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("[::1]")).toBe(true);
    expect(isLoopbackHost("huddle.example.com")).toBe(false);
    expect(isLoopbackHost("localhost.evil.com")).toBe(false);
  });
});

describe("POST /api/test/login guard (module-level)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  // The route reads the guard once at import, so re-import after stubbing env.
  async function call(url = "http://localhost:3200/api/test/login") {
    vi.resetModules();
    const { POST, GET } = await import("@/app/api/test/login/route");
    const post = await POST(
      new Request(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "e2e@example.com" }),
      }),
    );
    return { post, get: GET() };
  }

  it("404s in a production build even when E2E_AUTH=1", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("E2E_AUTH", "1");
    const { post, get } = await call();
    expect(post.status).toBe(404);
    expect(post.headers.get("set-cookie")).toBeNull();
    expect(get.status).toBe(404);
  });

  it("404s in development without E2E_AUTH", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("E2E_AUTH", "");
    expect((await call()).post.status).toBe(404);
  });

  it("404s for non-loopback hosts even when enabled", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("E2E_AUTH", "1");
    expect((await call("https://huddle.example.com/api/test/login")).post.status).toBe(404);
  });
});
