import { expect, test, type APIResponse } from "@playwright/test";
import { E2E_ADMIN_EMAIL } from "../support/e2e";
import { loginAs } from "./auth-helpers";

const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const IOS_CHROME_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.153 Mobile/15E148 Safari/604.1";

const stamp = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** PNG width/height from the IHDR chunk. */
async function pngSize(res: APIResponse) {
  const buf = await res.body();
  expect(buf.subarray(1, 4).toString("ascii")).toBe("PNG");
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

test.describe("link previews", () => {
  test("/opengraph-image and /twitter-image are 1200x630 PNGs without a session", async ({ request }) => {
    for (const path of ["/opengraph-image", "/twitter-image"]) {
      const res = await request.get(path, { maxRedirects: 0 });
      expect(res.status(), path).toBe(200);
      expect(res.headers()["content-type"], path).toContain("image/png");
      expect(await pngSize(res), path).toEqual({ width: 1200, height: 630 });
    }
  });

  test("the login page head carries Open Graph, Twitter, robots and splash tags", async ({ page }) => {
    await page.goto("/login");
    const meta = (sel: string) => page.locator(`head ${sel}`);
    await expect(meta('meta[property="og:title"]')).toHaveAttribute("content", "Sign in · Huddle");
    await expect(meta('meta[property="og:site_name"]')).toHaveAttribute("content", "Huddle");
    await expect(meta('meta[property="og:type"]')).toHaveAttribute("content", "website");
    await expect(meta('meta[property="og:image"]')).toHaveAttribute("content", /^https?:\/\/[^/]+\/opengraph-image/);
    await expect(meta('meta[property="og:image:width"]')).toHaveAttribute("content", "1200");
    await expect(meta('meta[property="og:image:height"]')).toHaveAttribute("content", "630");
    await expect(meta('meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image");
    await expect(meta('meta[name="twitter:image"]')).toHaveAttribute("content", /\/twitter-image/);
    await expect(meta('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expect(meta('link[rel="canonical"]')).toHaveAttribute("href", /\/login$/);
    await expect(meta('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute("content", "yes");

    const splash = page.locator('head link[rel="apple-touch-startup-image"]');
    await expect(splash).toHaveCount(12);
    await expect(splash.first()).toHaveAttribute("media", /device-width: 440px.*orientation: portrait/);
    // Every splash file exists.
    for (const href of await splash.evaluateAll((els) => els.map((e) => e.getAttribute("href")))) {
      const res = await page.request.get(href!);
      expect(res.status(), href!).toBe(200);
      expect(res.headers()["content-type"]).toContain("image/png");
    }
  });

  test("the root metadata (title template, description, OG) applies to app pages too", async ({ page }) => {
    await loginAs(page, `pwa-head-${stamp()}@example.com`);
    await page.goto("/home");
    await expect(page.locator('head meta[property="og:site_name"]')).toHaveAttribute("content", "Huddle");
    await expect(page.locator('head meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expect(page.locator('head meta[property="og:image"]')).toHaveAttribute("content", /\/opengraph-image/);
  });
});

test.describe("security headers", () => {
  test("pages carry the baseline headers", async ({ request }) => {
    for (const path of ["/login", "/install", "/offline"]) {
      const h = (await request.get(path)).headers();
      expect(h["strict-transport-security"], path).toContain("max-age=");
      expect(h["x-frame-options"], path).toBe("DENY");
      expect(h["x-content-type-options"], path).toBe("nosniff");
      expect(h["referrer-policy"], path).toBe("strict-origin-when-cross-origin");
      expect(h["permissions-policy"], path).toContain("microphone=()");
      expect(h["content-security-policy"], path).toBeUndefined();
    }
  });

  test("the service worker is served as JavaScript and never cached", async ({ request }) => {
    const res = await request.get("/sw.js");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("javascript");
    expect(res.headers()["cache-control"]).toContain("no-cache");
    expect(await res.text()).toContain("/offline");
  });
});

test.describe("install and offline pages", () => {
  test("/install is public and shows the three steps", async ({ page }) => {
    await page.goto("/install");
    await expect(page).toHaveURL(/\/install$/);
    await expect(page).toHaveTitle("Install · Huddle");
    await expect(page.getByRole("heading", { level: 1, name: /Add Huddle to your Home Screen/i })).toBeVisible();
    for (const step of ["Tap Share", "Add to Home Screen", "Open it from your Home Screen"]) {
      await expect(page.getByRole("heading", { level: 2, name: step })).toBeVisible();
    }
    await expect(page.getByText("Use Safari on iPhone")).toBeVisible();
    // Safari-on-iPhone (the emulated device) gets no "wrong device" notice.
    await expect(page.getByTestId("install-notice")).toHaveCount(0);
    await expect(page.locator('head meta[property="og:title"]')).toHaveAttribute("content", "Install · Huddle");
  });

  test("/install on a desktop browser says to open it on an iPhone", async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ baseURL, userAgent: DESKTOP_UA });
    const page = await ctx.newPage();
    await page.goto("/install");
    await expect(page.getByTestId("install-notice")).toContainText("Open this on your iPhone in Safari");
    await ctx.close();
  });

  test("/install in iOS Chrome says to use Safari", async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ baseURL, userAgent: IOS_CHROME_UA });
    const page = await ctx.newPage();
    await page.goto("/install");
    await expect(page.getByTestId("install-notice")).toContainText("Open this page in Safari");
    await ctx.close();
  });

  test("/install redirects to /home when already running from the Home Screen", async ({ page }) => {
    await loginAs(page, `pwa-standalone-${stamp()}@example.com`);
    await page.addInitScript(() => Object.defineProperty(navigator, "standalone", { value: true }));
    await page.goto("/install");
    await expect(page).toHaveURL(/\/home$/);
  });

  test("/login offers the install link on iOS Safari only", async ({ page, browser, baseURL }) => {
    await page.goto("/login");
    const link = page.getByRole("link", { name: "Install Huddle" });
    await expect(link).toHaveAttribute("href", "/install");

    const chrome = await browser.newContext({ baseURL, userAgent: IOS_CHROME_UA });
    const p2 = await chrome.newPage();
    await p2.goto("/login");
    await expect(p2.getByRole("button", { name: /Continue with Google/ })).toBeVisible();
    await expect(p2.getByRole("link", { name: "Install Huddle" })).toHaveCount(0);
    await chrome.close();
  });

  test("/offline renders without a session", async ({ page }) => {
    await page.goto("/offline");
    await expect(page).toHaveURL(/\/offline$/);
    await expect(page.getByRole("heading", { level: 1, name: /You.re offline/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "Try again" })).toHaveAttribute("href", "/home");
  });
});

test.describe("entrance animations don't hide content", () => {
  test("server HTML has no hidden stagger items and works without JavaScript", async ({ browser, baseURL, request }) => {
    const html = await (await request.get("/login")).text();
    expect(html).toContain("stagger-item");
    expect(html).not.toMatch(/style="[^"]*opacity:\s*0/);

    const ctx = await browser.newContext({ baseURL, javaScriptEnabled: false });
    const page = await ctx.newPage();
    await page.goto("/login");
    await expect(page.getByRole("heading", { level: 1, name: "Huddle" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Continue with Google/ })).toBeVisible();
    await ctx.close();
  });

  test("items finish fully visible with no transform left behind", async ({ page }) => {
    await page.goto("/login");
    const h1 = page.getByRole("heading", { level: 1, name: "Huddle" });
    await expect(h1).toBeVisible();
    const item = (prop: "opacity" | "transform") => h1.evaluate((el, p) => getComputedStyle(el.closest(".stagger-item")!)[p], prop);
    // Once the entrance is over the element is untouched: opaque, and no transform (so no containing block).
    await expect.poll(() => item("transform")).toBe("none");
    expect(await item("opacity")).toBe("1");
  });
});

test.describe("admin ingest log 404s", () => {
  test("an unknown or malformed user id is a real 404 status", async ({ page }) => {
    await loginAs(page, E2E_ADMIN_EMAIL);
    for (const id of ["00000000-0000-4000-8000-000000000000", "not-a-uuid"]) {
      const res = await page.goto(`/admin/data/${id}`);
      expect(res?.status(), id).toBe(404);
      await expect(page.getByText("This page could not be found")).toBeVisible();
    }
  });
});

test.describe("nested sheets", () => {
  test("Escape closes only the topmost sheet", async ({ page }) => {
    await loginAs(page, `pwa-sheets-${stamp()}@example.com`);
    await page.goto("/profile");
    await page.getByRole("button", { name: "Edit preferences" }).click();
    const prefs = page.getByRole("dialog", { name: "Preferences" });
    await expect(prefs).toBeVisible();

    // The timezone field opens a second sheet on top of the first.
    await prefs.locator('button[aria-haspopup="dialog"]').click();
    const tz = page.getByRole("dialog", { name: "Timezone" });
    await expect(tz).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(tz).toHaveCount(0);
    await expect(prefs).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(prefs).toHaveCount(0);
  });
});

test.describe("sync screen layout", () => {
  test("the stats card sits above the tab bar on an iPhone 15 viewport", async ({ page }) => {
    await loginAs(page, `pwa-sync-${stamp()}@example.com`);
    await page.goto("/sync");
    const stats = page.getByText("Days covered");
    await expect(stats).toBeVisible();
    const tabBar = page.getByRole("navigation", { name: "Primary" });
    // Let the entrance settle so positions are final.
    await page.waitForTimeout(1200);
    const card = await stats.evaluate((el) => el.closest("dl")!.getBoundingClientRect().bottom);
    const tabTop = await tabBar.evaluate((el) => el.getBoundingClientRect().top);
    expect(card).toBeLessThanOrEqual(tabTop);
  });
});
