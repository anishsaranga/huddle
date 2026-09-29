import { expect, request as playwrightRequest, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { TEST_DATABASE_URL } from "../support/test-db";
import { loginAs } from "./auth-helpers";

test.setTimeout(120_000);

const KEY_RE = /^gk_[A-Za-z0-9_-]{43}$/;
const stamp = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** Status of GET /api/me/sync-status with only a Bearer key (no cookies). */
async function keyStatus(baseURL: string, key: string): Promise<number> {
  const ctx = await playwrightRequest.newContext({ baseURL });
  try {
    const res = await ctx.get("/api/me/sync-status", { headers: { authorization: `Bearer ${key}` } });
    return res.status();
  } finally {
    await ctx.dispose();
  }
}

async function readKey(page: Page): Promise<string> {
  const value = page.getByTestId("api-key-value");
  await expect(value).toBeVisible();
  const key = (await value.textContent())?.trim() ?? "";
  expect(key).toMatch(KEY_RE);
  return key;
}

test.describe("onboarding", () => {
  test("the final step reveals a gk_ key once, with copy", async ({ page, context, baseURL }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const id = stamp();
    const email = `e2e-key-onb-${id}@example.com`;
    const { userId } = await loginAs(page, email, { onboarded: false, name: "Key Tester" });

    // Fill every onboarding field so the flow resumes at the final step.
    const sql = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
    try {
      await sql`
        update users set username = ${`key_${id}`.slice(0, 20)}, display_name = 'Key Tester', avatar_kind = 'dicebear',
          timezone = 'Europe/London', units = 'metric', dob = '1990-01-01', sex = 'female',
          height_cm = 170, weight_kg = 65, step_goal = 8000, sleep_goal_min = 480
        where id = ${userId}`;
    } finally {
      await sql.end();
    }

    await page.goto("/onboarding");
    await expect(page.getByRole("heading", { name: "You’re in" })).toBeVisible();
    const key = await readKey(page);
    await expect(page.getByText("You won’t see this again — save it to the Shortcut now.")).toBeVisible();
    await expect(page.getByTestId("ingest-url")).toHaveText(/\/api\/ingest$/);

    await page.getByRole("button", { name: "Copy key" }).click();
    await expect(page.getByRole("button", { name: "Key copied" })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Key copied" })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(key);

    expect(await keyStatus(baseURL!, key)).toBe(200);

    // A reload can't show the key again; it offers a new one instead.
    await page.reload();
    await expect(page.getByText("You already have a key.", { exact: false })).toBeVisible();
    await expect(page.getByText(key.slice(0, 8))).toBeVisible();
    await expect(page.getByTestId("api-key-value")).toHaveCount(0);

    await page.getByRole("button", { name: "Make a new key" }).click();
    const replacement = await readKey(page);
    expect(replacement).not.toBe(key);
    expect(await keyStatus(baseURL!, key)).toBe(401);
    expect(await keyStatus(baseURL!, replacement)).toBe(200);
  });
});

test.describe("profile", () => {
  test("create, regenerate and revoke the key", async ({ page, baseURL }) => {
    await loginAs(page, `e2e-key-prof-${stamp()}@example.com`, { name: "Key Owner" });
    await page.goto("/profile");

    const hint = page.getByTestId("key-hint");
    await expect(page.getByText("No key", { exact: true })).toBeVisible();

    // Create (no confirm needed when there's no key).
    await page.getByRole("button", { name: "Create key" }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("heading", { name: "Your new key" })).toBeVisible();
    const first = await readKey(page);
    await sheet.getByRole("button", { name: "I’ve saved it" }).click();
    await expect(sheet).toHaveCount(0);
    await expect(hint).toHaveText(`${first.slice(0, 8)}••••`);
    await expect(page.getByText("Never", { exact: true })).toBeVisible();

    // Regenerate: confirm, then a new one-time reveal; the hint changes and the old key stops working.
    await page.getByRole("button", { name: "Regenerate" }).click();
    await expect(page.getByRole("heading", { name: "Regenerate key?" })).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Regenerate" }).click();
    await expect(page.getByRole("heading", { name: "Your new key" })).toBeVisible();
    const second = await readKey(page);
    expect(second).not.toBe(first);
    await page.getByRole("dialog").getByRole("button", { name: "I’ve saved it" }).click();
    await expect(hint).toHaveText(`${second.slice(0, 8)}••••`);
    expect(await keyStatus(baseURL!, first)).toBe(401);
    expect(await keyStatus(baseURL!, second)).toBe(200);

    // The key was just used, and a reload shows the same hint (the key itself is never re-shown).
    await page.reload();
    await expect(hint).toHaveText(`${second.slice(0, 8)}••••`);
    await expect(page.getByText("Just now")).toBeVisible();
    await expect(page.getByTestId("api-key-value")).toHaveCount(0);

    // Revoke.
    await page.getByRole("button", { name: "Revoke" }).click();
    await expect(page.getByRole("heading", { name: "Revoke key?" })).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Revoke key" }).click();
    await expect(page.getByText("No key", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create key" })).toBeVisible();
    await expect(hint).toHaveCount(0);
    expect(await keyStatus(baseURL!, second)).toBe(401);
  });
});
