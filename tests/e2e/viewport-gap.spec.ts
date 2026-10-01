import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { TEST_DATABASE_URL } from "../support/test-db";
import { loginAs } from "./auth-helpers";
import { stamp } from "./seed-helpers";

/**
 * iOS 26 standalone bottom gap (src/lib/pwa/viewport-gap.ts). Chromium isn't standalone, so the head
 * script leaves --vh-gap unset (layout must be exactly as before); forcing the property simulates a
 * measured gap: bottom chrome and full-screen overlays must extend that far past the viewport.
 */

const GAP = 34;

const setGap = (page: Page, px: number) =>
  page.evaluate((v) => document.documentElement.style.setProperty("--vh-gap", `${v}px`), px);

const vh = (page: Page) => page.viewportSize()!.height;

/** Rect of the element, read once its entrance animation has settled. */
const rect = (page: Page, selector: string) =>
  page.evaluate((sel) => {
    const r = document.querySelector(sel)!.getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height) };
  }, selector);

const TAB_BAR = 'nav[aria-label="Primary"]';

async function expectChrome(page: Page, gap: number) {
  // Tab bar flush with the (physical) bottom; the shell around <main> as tall as the screen.
  await expect.poll(async () => (await rect(page, TAB_BAR)).bottom).toBe(vh(page) + gap);
  const shell = await page.locator("main").evaluate((m) => Math.round(m.parentElement!.getBoundingClientRect().height));
  expect(shell).toBe(vh(page) + gap);
  // The main scroller still ends at the shell's bottom, behind the tab bar.
  expect(await page.locator("main").evaluate((m) => Math.round(m.getBoundingClientRect().bottom))).toBe(vh(page) + gap);
}

async function expectSheet(page: Page, gap: number) {
  await page.getByTestId("delete-account").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Delete account" })).toBeVisible();
  // The overlay (backdrop) and the panel reach the physical bottom.
  await expect
    .poll(() => dialog.evaluate((d) => Math.round(d.parentElement!.getBoundingClientRect().bottom)))
    .toBe(vh(page) + gap);
  await expect.poll(() => dialog.evaluate((d) => Math.round(d.getBoundingClientRect().bottom))).toBe(vh(page) + gap);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
}

test("gap 0 (every browser but buggy iOS standalone): --vh-gap unset, chrome flush with the viewport", async ({ page }) => {
  await loginAs(page, `e2e-vh0-${stamp()}@example.com`);
  await page.goto("/home");
  await expect(page.locator(TAB_BAR)).toBeVisible();

  // The measuring script is in the head but does nothing outside standalone mode.
  expect(await page.evaluate(() => [...document.head.querySelectorAll("script")].some((s) => s.textContent?.includes("--vh-gap")))).toBe(true);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--vh-gap"))).toBe("");

  await expectChrome(page, 0);
  await page.goto("/profile");
  await expectChrome(page, 0);
  await expectSheet(page, 0);
});

test("forced 34px gap: tab bar, app shell and sheet overlay extend past the viewport by the gap", async ({ page }) => {
  await loginAs(page, `e2e-vh34-${stamp()}@example.com`);
  await page.goto("/home");
  await expect(page.locator(TAB_BAR)).toBeVisible();
  await setGap(page, GAP);
  await expectChrome(page, GAP);

  // Survives client-side navigation (the property lives on <html>).
  await page.locator(TAB_BAR).getByRole("link", { name: "Profile" }).click();
  await expect(page).toHaveURL(/\/profile$/);
  await expectChrome(page, GAP);
  await expectSheet(page, GAP);
});

test("simulated iOS standalone with a short viewport: the head script measures 34px before hydration", async ({ browser }) => {
  // The bug's shape: the fixed containing block (viewport) is 34px shorter than the screen.
  const ctx = await browser.newContext({
    ...test.info().project.use,
    viewport: { width: 393, height: 818 },
    screen: { width: 393, height: 852 },
  });
  try {
    await ctx.addInitScript(() => Object.defineProperty(Navigator.prototype, "standalone", { get: () => true }));
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    page.on("pageerror", (e) => errors.push(e.message));
    await loginAs(page, `e2e-vhsa-${stamp()}@example.com`);
    await page.goto("/home");
    await expect(page.locator(TAB_BAR)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.style.getPropertyValue("--vh-gap"))).toBe(`${GAP}px`);
    await expectChrome(page, GAP);
    expect(errors.filter((e) => /hydrat/i.test(e))).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test("chat composer sits right on top of the tab bar with and without the gap", async ({ page }) => {
  const { userId } = await loginAs(page, `e2e-vhchat-${stamp()}@example.com`, { name: "Gap Chat" });
  const sql = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  let groupId: string;
  try {
    [{ id: groupId }] = await sql<{ id: string }[]>`insert into groups (name, timezone) values (${`Gap ${stamp()}`}, 'UTC') returning id`;
    await sql`insert into group_members (group_id, user_id) values (${groupId}, ${userId})`;
  } finally {
    await sql.end();
  }

  await page.goto(`/groups/${groupId}?tab=chat`);
  const composer = page.getByRole("textbox", { name: "Message" });
  await expect(composer).toBeVisible();
  const composerBottom = () => composer.evaluate((t) => Math.round(t.closest(".fixed")!.getBoundingClientRect().bottom));

  const tabbarH = await page.evaluate(() =>
    parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--tabbar-h")),
  );
  for (const gap of [0, GAP]) {
    await setGap(page, gap);
    await expect.poll(async () => (await rect(page, TAB_BAR)).bottom).toBe(vh(page) + gap);
    // The bar's row (--tabbar-h, under its 1px top border) starts right where the composer ends.
    await expect.poll(composerBottom).toBe(vh(page) + gap - tabbarH);
  }
});
