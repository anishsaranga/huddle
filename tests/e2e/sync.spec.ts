import { expect, request as playwrightRequest, test, type Page } from "@playwright/test";
import { loginAs } from "./auth-helpers";

test.setTimeout(120_000);

const KEY_RE = /^gk_[A-Za-z0-9_-]{43}$/;
const SHORTCUT_URL = "shortcuts://run-shortcut?name=Huddle%20Sync&input=text&text=force";
const stamp = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const utcToday = () => new Date().toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** A small valid series payload covering the last `days` UTC dates (test users have no timezone → UTC). */
function seriesPayload(days: number) {
  const today = utcToday();
  const dates = Array.from({ length: days }, (_, i) => addDays(today, i - days + 1));
  return {
    window: { from: dates[0], to: today },
    series: { steps: { starts: dates.join("\n"), values: dates.map((_, i) => 5000 + i * 100).join("\n") } },
    meta: { shortcut_version: "1" },
  };
}

/** POST /api/ingest from its own client IP (the per-IP limit is shared by the whole suite otherwise). */
async function ingest(baseURL: string, key: string, body: unknown): Promise<number> {
  const api = await playwrightRequest.newContext({
    baseURL,
    extraHTTPHeaders: { "x-forwarded-for": `203.0.113.${Math.floor(Math.random() * 250) + 1}` },
  });
  try {
    const res = await api.post("/api/ingest", { headers: { authorization: `Bearer ${key}` }, data: body, maxRetries: 3 });
    return res.status();
  } finally {
    await api.dispose();
  }
}

/** What the Shortcut does after Sync now: it takes a moment to run, then posts. */
async function shortcutPosts(page: Page, baseURL: string, key: string, body: unknown): Promise<number> {
  await page.waitForTimeout(600);
  return ingest(baseURL, key, body);
}

async function keyStatus(baseURL: string, key: string): Promise<number> {
  const ctx = await playwrightRequest.newContext({ baseURL });
  try {
    return (await ctx.get("/api/me/sync-status", { headers: { authorization: `Bearer ${key}` } })).status();
  } finally {
    await ctx.dispose();
  }
}

async function readKey(page: Page): Promise<string> {
  const value = page.getByTestId("api-key-value");
  await expect(value).toBeVisible();
  const key = ((await value.textContent()) ?? "").trim();
  expect(key).toMatch(KEY_RE);
  return key;
}

/** Sign in and create a key on /setup; returns the plaintext key. */
async function userWithKey(page: Page, prefix: string): Promise<string> {
  await loginAs(page, `e2e-${stamp()}-${prefix}@example.com`, { name: "Sync Tester" });
  await page.goto("/setup");
  await page.getByRole("button", { name: "Create key" }).click();
  return readKey(page);
}

/** Capture the shortcuts:// navigation and shorten timers (see src/lib/sync/launch.ts). */
async function installSyncHooks(page: Page, hooks: { timeoutMs?: number; stayedMs?: number } = {}) {
  await page.addInitScript((h) => {
    const w = window as unknown as { __huddleSync: object; __opened: string[] };
    w.__opened = [];
    w.__huddleSync = { ...h, openUrl: (url: string) => w.__opened.push(url) };
  }, hooks);
}

const openedUrls = (page: Page) => page.evaluate(() => (window as unknown as { __opened: string[] }).__opened);

/** What iOS does when you switch to Shortcuts and swipe back: hidden, then visible. */
async function leaveAndComeBack(page: Page) {
  await page.evaluate(() => {
    const set = (v: "hidden" | "visible") => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => v });
      Object.defineProperty(document, "hidden", { configurable: true, get: () => v === "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    };
    set("hidden");
    set("visible");
  });
}

const syncState = (page: Page) => page.getByTestId("sync-state");

test.describe("/setup", () => {
  test("shows the ingest URL and key hint, and a new key replaces the old one", async ({ page, baseURL }) => {
    const first = await userWithKey(page, "setup");
    await expect(page.getByTestId("ingest-url")).toHaveText(/\/api\/ingest$/);
    // The freshly made key also lands in the recipe's HuddleKey step.
    await page.getByRole("button", { name: /Your URL and key/ }).click();
    await expect(page.getByTestId("recipe-key")).toHaveText(first);
    await expect(page.getByTestId("recipe-url")).toHaveText(/\/api\/ingest$/);

    // After a reload only the hint is left.
    await page.reload();
    await expect(page.getByTestId("key-hint")).toHaveText(`${first.slice(0, 8)}••••`);
    await expect(page.getByTestId("api-key-value")).toHaveCount(0);
    // SHORTCUT_ICLOUD_URL is unset in e2e and public/shortcuts/huddle-sync.shortcut is not committed: neither install path exists.
    await expect(page.getByTestId("icloud-missing")).toContainText("Install link not published yet");
    await expect(page.getByTestId("shortcut-download")).toHaveCount(0);
    await expect(page.getByTestId("icloud-install")).toHaveCount(0);

    await page.getByRole("button", { name: "Show a new key" }).click();
    await expect(page.getByRole("heading", { name: "Show a new key?" })).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Make a new key" }).click();
    const second = await readKey(page);
    expect(second).not.toBe(first);
    await expect(page.getByText("Your previous key has stopped working.", { exact: false })).toBeVisible();
    expect(await keyStatus(baseURL!, first)).toBe(401);
    expect(await keyStatus(baseURL!, second)).toBe(200);
  });

  test("the device picker marks which metric blocks to skip", async ({ page }) => {
    await loginAs(page, `e2e-${stamp()}-setup-dev@example.com`);
    await page.goto("/setup");
    await page.getByRole("radio", { name: "Fitbit" }).click();
    await page.getByRole("button", { name: /Measurements/ }).click();
    const body = page.getByTestId("step-body-measures");
    await expect(body.locator('[data-metric="hrv_sdnn_ms"]')).toHaveAttribute("data-advice", "skip");
    await expect(body.locator('[data-metric="resting_hr"]')).toHaveAttribute("data-advice", "include");
    await page.getByRole("radio", { name: "Apple Watch" }).click();
    await expect(body.locator('[data-metric="hrv_sdnn_ms"]')).toHaveAttribute("data-advice", "include");
  });

  test("shows the last failed attempt's error", async ({ page, baseURL }) => {
    const key = await userWithKey(page, "setup-err");
    expect(await ingest(baseURL!, key, { series: { steps: { starts: utcToday(), values: "lots" } } })).toBe(400);
    await page.reload();
    const banner = page.getByTestId("setup-error");
    await expect(banner).toContainText("HTTP 400");
    await expect(banner).toContainText('series.steps.values[0]: expected a number, got "…"');
    await expect(page.getByTestId("trouble-400-error")).toHaveText('series.steps.values[0]: expected a number, got "…"');
  });
});

test.describe("/sync primary state", () => {
  test("no key → create one on /setup", async ({ page }) => {
    await loginAs(page, `e2e-${stamp()}-nokey@example.com`);
    await page.goto("/sync");
    await expect(syncState(page)).toHaveAttribute("data-setup", "no-key");
    await expect(page.getByRole("heading", { name: "Create your sync key" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Set up sync" })).toHaveAttribute("href", "/setup");
    await expect(page.getByRole("button", { name: "Sync now" })).toHaveCount(0);
  });

  test("key but never synced → set up the Shortcut first, run it as a secondary", async ({ page }) => {
    await userWithKey(page, "sync-never");
    await page.goto("/sync");
    await expect(syncState(page)).toHaveAttribute("data-setup", "never");
    await expect(page.getByRole("heading", { name: "Set up the Shortcut first" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open setup guide" })).toHaveAttribute("href", "/setup");
    await expect(page.getByRole("button", { name: "I’ve installed it — run it" })).toBeVisible();
  });

  test("synced → Sync now", async ({ page, baseURL }) => {
    const key = await userWithKey(page, "sync-ready");
    expect(await ingest(baseURL!, key, seriesPayload(5))).toBe(200);
    await page.goto("/sync");
    await expect(syncState(page)).toHaveAttribute("data-setup", "ready");
    await expect(page.getByRole("heading", { name: "Ready to sync" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sync now" })).toBeVisible();
    await expect(page.getByTestId("days-covered")).toHaveText("5");
    await expect(page.getByTestId("orb-value")).toHaveText("Now");
  });
});

test.describe("Sync now", () => {
  test("opens the Shortcut, waits, and shows Synced when the ingest arrives", async ({ page, baseURL }) => {
    await installSyncHooks(page);
    const key = await userWithKey(page, "syncnow-ok");
    expect(await ingest(baseURL!, key, seriesPayload(10))).toBe(200);
    await page.goto("/sync");

    await page.getByRole("button", { name: "Sync now" }).click();
    expect(await openedUrls(page)).toEqual([SHORTCUT_URL]);
    await expect(syncState(page)).toHaveAttribute("data-phase", "launching");

    await leaveAndComeBack(page);
    await expect(page.getByRole("heading", { name: "Waiting for your Shortcut…" })).toBeVisible();

    expect(await shortcutPosts(page, baseURL!, key, seriesPayload(3))).toBe(200);
    await expect(page.getByRole("heading", { name: "Synced" })).toBeVisible({ timeout: 15_000 });
    await expect(syncState(page)).toContainText("3 days updated");
    await expect(page.getByTestId("orb-value")).toHaveText("+3");

    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByRole("heading", { name: "Ready to sync" })).toBeVisible();
  });

  test("shows the server's error when the Shortcut's request is rejected", async ({ page, baseURL }) => {
    await installSyncHooks(page);
    const key = await userWithKey(page, "syncnow-err");
    expect(await ingest(baseURL!, key, seriesPayload(2))).toBe(200);
    await page.goto("/sync");

    await page.getByRole("button", { name: "Sync now" }).click();
    await leaveAndComeBack(page);
    await expect(syncState(page)).toHaveAttribute("data-phase", "waiting");
    expect(await shortcutPosts(page, baseURL!, key, { series: { steps: { starts: utcToday(), values: "lots" } } })).toBe(400);

    await expect(page.getByRole("heading", { name: "Sync failed" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("sync-error")).toHaveText('series.steps.values[0]: expected a number, got "…"');
    await expect(page.getByRole("link", { name: "Troubleshoot" })).toHaveAttribute("href", "/setup#troubleshooting");
  });

  test("gives up when nothing arrives", async ({ page, baseURL }) => {
    await installSyncHooks(page, { timeoutMs: 3_000 });
    const key = await userWithKey(page, "syncnow-timeout");
    expect(await ingest(baseURL!, key, seriesPayload(2))).toBe(200);
    await page.goto("/sync");

    await page.getByRole("button", { name: "Sync now" }).click();
    await leaveAndComeBack(page);
    await expect(page.getByRole("heading", { name: "Waiting for your Shortcut…" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Didn’t hear from your Shortcut" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("link", { name: "Open setup guide" })).toHaveAttribute("href", "/setup#troubleshooting");
  });

  test("says to use the iPhone when the page never goes away", async ({ page, baseURL }) => {
    await installSyncHooks(page, { stayedMs: 1_000 });
    const key = await userWithKey(page, "syncnow-stayed");
    expect(await ingest(baseURL!, key, seriesPayload(2))).toBe(200);
    await page.goto("/sync");

    await page.getByRole("button", { name: "Sync now" }).click();
    await expect(page.getByRole("heading", { name: "Open this on your iPhone" })).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("heading", { name: "Ready to sync" })).toBeVisible();
  });

  test("picks the wait up again after the app reloads on return", async ({ page, baseURL }) => {
    await installSyncHooks(page);
    const key = await userWithKey(page, "syncnow-resume");
    expect(await ingest(baseURL!, key, seriesPayload(2))).toBe(200);
    await page.goto("/sync");

    await page.getByRole("button", { name: "Sync now" }).click();
    // iOS may kill the PWA while Shortcuts runs; it restarts on /sync.
    expect(await shortcutPosts(page, baseURL!, key, seriesPayload(4))).toBe(200);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Synced" })).toBeVisible({ timeout: 15_000 });
    await expect(syncState(page)).toContainText("4 days updated");
  });
});

test.describe("entry points", () => {
  test("Home's first-run card links to /setup", async ({ page }) => {
    await loginAs(page, `e2e-${stamp()}-home@example.com`);
    await page.goto("/home");
    await expect(page.getByRole("link", { name: "Connect your iPhone" })).toHaveAttribute("href", "/setup");
  });
});
