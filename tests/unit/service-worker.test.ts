import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

// public/sw.js is plain JS served as-is; load it in a bare VM context (no `self` listeners) to reach its pure helpers.
type Sw = {
  classify: (url: URL, req: { method: string; mode: string; destination?: string }, origin: string) => string;
  isServerDown: (status: number) => boolean;
  extractAssetUrls: (text: string) => string[];
};
const sandbox: { self: object; module: { exports: Partial<Sw> } } = { self: {}, module: { exports: {} } };
vm.runInNewContext(readFileSync(path.join(process.cwd(), "public", "sw.js"), "utf8"), sandbox);
const sw = sandbox.module.exports as Sw;

const ORIGIN = "https://huddle.example.com";
const kind = (p: string, req: { method?: string; mode?: string; destination?: string } = {}, origin = ORIGIN) =>
  sw.classify(new URL(p, ORIGIN), { method: "GET", mode: "cors", ...req }, origin);

describe("service worker route classification", () => {
  it("never touches the API, whatever the method or mode", () => {
    for (const p of [
      "/api/ingest",
      "/api/me/sync-status",
      "/api/me/avatar",
      "/api/groups/123/stream",
      "/api/auth/session",
      "/api/avatar/abc?v=1",
      "/api",
    ]) {
      expect(kind(p), p).toBe("bypass");
      expect(kind(p, { mode: "navigate" }), `${p} (navigate)`).toBe("bypass");
    }
  });

  it("ignores non-GET requests and other origins", () => {
    expect(kind("/home", { method: "POST", mode: "navigate" })).toBe("bypass");
    expect(kind("/_next/static/chunks/a.js", { method: "POST" })).toBe("bypass");
    expect(sw.classify(new URL("https://other.example/_next/static/a.js"), { method: "GET", mode: "cors" }, ORIGIN)).toBe("bypass");
  });

  it("navigations are network-first", () => {
    for (const p of ["/home", "/groups/abc", "/offline", "/login"]) expect(kind(p, { mode: "navigate" }), p).toBe("navigate");
  });

  it("immutable assets are cache-first", () => {
    expect(kind("/_next/static/chunks/abc123.js")).toBe("static");
    expect(kind("/_next/static/media/font.woff2", { destination: "font" })).toBe("static");
    expect(kind("/icons/icon-192.png")).toBe("static");
    expect(kind("/somewhere/f.woff2", { destination: "font" })).toBe("static");
  });

  it("leaves everything else alone (RSC payloads, images, data)", () => {
    expect(kind("/home?_rsc=1abc")).toBe("bypass");
    expect(kind("/opengraph-image")).toBe("bypass");
    expect(kind("/_next/image?url=x")).toBe("bypass");
  });
});

describe("service worker helpers", () => {
  it("falls back to /offline only for outage statuses, not app errors", () => {
    for (const s of [502, 503, 504, 520, 522, 530]) expect(sw.isServerDown(s), String(s)).toBe(true);
    for (const s of [200, 301, 401, 404, 429, 500]) expect(sw.isServerDown(s), String(s)).toBe(false);
  });

  it("pulls hashed asset URLs out of HTML, RSC payloads and CSS", () => {
    const html = `<link rel="stylesheet" href="/_next/static/chunks/0abc.css"/><script src="/_next/static/chunks/main-xyz.js" async></script>
      self.__next_f.push([1,"...\\"/_next/static/chunks/page-1.js\\""]) <a href="/home">x</a>`;
    expect(sw.extractAssetUrls(html).sort()).toEqual([
      "/_next/static/chunks/0abc.css",
      "/_next/static/chunks/main-xyz.js",
      "/_next/static/chunks/page-1.js",
    ]);
    expect(sw.extractAssetUrls("@font-face{src:url(/_next/static/media/abc-s.p.woff2) format('woff2')}")).toEqual([
      "/_next/static/media/abc-s.p.woff2",
    ]);
  });
});
