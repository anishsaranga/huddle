import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { E2E_ADMIN_EMAIL } from "../support/e2e";
import { TEST_DATABASE_URL } from "../support/test-db";
import { loginAs } from "./auth-helpers";

const stamp = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

async function usernameOf(userId: string): Promise<string> {
  const sql = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    const [row] = await sql<{ username: string }[]>`select username from users where id = ${userId}`;
    return row.username;
  } finally {
    await sql.end();
  }
}

test.describe("export", () => {
  test("Export my data downloads a valid JSON file", async ({ page }) => {
    const { userId } = await loginAs(page, `e2e-export-${stamp()}@example.com`, { name: "Export Tester" });
    const username = await usernameOf(userId);
    await page.goto("/profile");

    const link = page.getByTestId("export-data");
    await expect(link).toHaveAttribute("href", "/api/me/export");
    const [download] = await Promise.all([page.waitForEvent("download"), link.click()]);

    expect(download.suggestedFilename()).toMatch(new RegExp(`^huddle-export-${username}-\\d{4}-\\d{2}-\\d{2}\\.json$`));
    const file = await download.path();
    const json = JSON.parse(await readFile(file, "utf8"));
    expect(json.format_version).toBe(1);
    expect(json.profile).toMatchObject({ id: userId, username });
    for (const section of ["api_keys", "groups", "daily_metrics", "hr_hourly", "sleep_nights", "sleep_segments", "daily_scores", "ingest_events", "messages", "reactions", "champion_awards"]) {
      expect(Array.isArray(json[section]), section).toBe(true);
    }
    // Still on Profile: a download doesn't navigate away.
    await expect(page).toHaveURL(/\/profile$/);
  });
});

test.describe("delete account", () => {
  test("type the username, delete, land on /login with the notice; the old session is dead", async ({ page, context }) => {
    const { userId } = await loginAs(page, `e2e-delete-${stamp()}@example.com`, { name: "Delete Tester" });
    const username = await usernameOf(userId);
    const oldCookies = await context.cookies();
    await page.goto("/profile");

    await page.getByTestId("delete-account").click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("heading", { name: "Delete account" })).toBeVisible();
    await expect(sheet.getByText("Deleted user")).toBeVisible();

    const confirm = sheet.getByTestId("delete-confirm");
    const input = sheet.getByTestId("delete-confirm-input");
    await expect(confirm).toBeDisabled();
    await input.fill("not-my-name");
    await expect(confirm).toBeDisabled();
    await input.fill(username);
    await expect(confirm).toBeEnabled();
    await confirm.click();

    await page.waitForURL(/\/login\?deleted=1$/);
    await expect(page.getByTestId("account-deleted")).toHaveText("Your account and data were deleted.");

    // The user is gone, and so is the old session, even if its cookie is put back.
    const sql = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
    try {
      expect(await sql`select 1 from users where id = ${userId}`).toHaveLength(0);
      expect(await sql`select 1 from sessions where user_id = ${userId}`).toHaveLength(0);
    } finally {
      await sql.end();
    }
    await context.clearCookies();
    await context.addCookies(oldCookies);
    await page.goto("/profile");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("button", { name: /Continue with Google/ })).toBeVisible();
  });

  test("a wrong username never deletes, and Cancel closes the sheet", async ({ page }) => {
    const { userId } = await loginAs(page, `e2e-delete-cancel-${stamp()}@example.com`);
    await page.goto("/profile");
    await page.getByTestId("delete-account").click();
    const sheet = page.getByRole("dialog");
    await sheet.getByTestId("delete-confirm-input").fill("nope");
    await expect(sheet.getByTestId("delete-confirm")).toBeDisabled();
    await sheet.getByRole("button", { name: "Cancel" }).click();
    await expect(sheet).toBeHidden();

    const sql = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
    try {
      expect(await sql`select 1 from users where id = ${userId}`).toHaveLength(1);
    } finally {
      await sql.end();
    }
  });

  test("the admin's Delete account row is disabled", async ({ page }) => {
    await loginAs(page, E2E_ADMIN_EMAIL, { name: "E2E Admin" });
    await page.goto("/profile");
    await expect(page.getByText("The admin account can't be deleted")).toBeVisible();
    await expect(page.getByTestId("delete-account")).toHaveCount(0);
  });
});
