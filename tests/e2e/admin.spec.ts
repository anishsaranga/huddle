import { test, expect, type Browser, type Page } from "@playwright/test";
import { E2E_ADMIN_EMAIL } from "../support/e2e";
import { loginAs } from "./auth-helpers";

// One admin at a time: these tests share a database with the rest of the suite.
test.describe.configure({ mode: "serial" });

const run = Date.now().toString(36);

/** A second browser context (its own cookies) signed in as `email`. */
async function otherUser(browser: Browser, baseURL: string, email: string, name: string) {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await loginAs(page, email, { name });
  return { context, page };
}

async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
}

test.describe("non-admins", () => {
  test("get a 404 for every admin page", async ({ page }) => {
    await loginAs(page, `e2e-plain-${run}@example.com`);
    for (const path of ["/admin", "/admin/allowlist", "/admin/groups", "/admin/users", "/admin/data"]) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(404);
      await expect(page.getByText("Allowlist", { exact: true })).toHaveCount(0);
    }
  });

  test("don't see the Admin card on Profile", async ({ page }) => {
    await loginAs(page, `e2e-plain2-${run}@example.com`);
    await page.goto("/profile");
    await expect(page.getByRole("button", { name: "Edit personal" })).toBeVisible();
    await expect(page.locator("a[href='/admin']")).toHaveCount(0);
  });

  test("signed-out visitors are sent to /login", async ({ page }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe("admin", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, E2E_ADMIN_EMAIL, { name: "Admin E2E" });
  });

  test("Profile links to the admin area, which lands on the allowlist", async ({ page }) => {
    await page.goto("/profile");
    await page.locator("a[href='/admin']").click();
    await expect(page).toHaveURL(/\/admin\/allowlist$/);
    await expect(page.getByRole("heading", { name: "Allowlist" })).toBeVisible();
    // The admin address is pinned with an ADMIN badge and can't be removed.
    await expect(page.getByText(E2E_ADMIN_EMAIL, { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: `Remove ${E2E_ADMIN_EMAIL}` })).toHaveCount(0);
    // Back link returns to Profile.
    await page.getByRole("link", { name: "Profile" }).click();
    await expect(page).toHaveURL(/\/profile$/);
  });

  test("allowlist: add (normalized), reject a duplicate, remove via confirm sheet", async ({ page }) => {
    const email = `friend-${run}@example.com`;
    await page.goto("/admin/allowlist");
    await settle(page);

    await page.getByLabel("Add an email").fill(`  Friend-${run}@Example.COM `);
    await page.getByRole("button", { name: "Add to allowlist" }).click();
    await expect(page.getByText("Added to the allowlist")).toBeVisible();
    await expect(page.getByText(email, { exact: true })).toBeVisible();
    await expect(page.getByLabel("Add an email")).toHaveValue("");

    // Duplicate: inline error, list unchanged.
    await page.getByLabel("Add an email").fill(email.toUpperCase());
    await page.getByRole("button", { name: "Add to allowlist" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "already on the list" }).first()).toBeVisible();
    await expect(page.getByText(email, { exact: true })).toHaveCount(1);

    // Invalid.
    await page.getByLabel("Add an email").fill("nope");
    await page.getByRole("button", { name: "Add to allowlist" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "valid email" }).first()).toBeVisible();

    // Remove needs confirmation.
    await page.getByRole("button", { name: `Remove ${email}` }).click();
    const sheet = page.getByRole("dialog", { name: "Remove email?" });
    await expect(sheet).toBeVisible();
    await sheet.getByRole("button", { name: "Cancel" }).click();
    await expect(sheet).toBeHidden();
    await expect(page.getByText(email, { exact: true })).toBeVisible();

    await page.getByRole("button", { name: `Remove ${email}` }).click();
    await page.getByRole("dialog", { name: "Remove email?" }).getByRole("button", { name: "Remove" }).click();
    await expect(page.getByText(email, { exact: true })).toHaveCount(0);
    await expect(page.getByText("Removed from the allowlist")).toBeVisible();
  });

  test("groups: create, add a member, remove, rename, delete", async ({ page, browser, baseURL }) => {
    const memberEmail = `member-${run}@example.com`;
    const memberName = `Member ${run}`;
    const member = await otherUser(browser, baseURL!, memberEmail, memberName);

    try {
      await page.goto("/admin/groups");
      await settle(page);
      await page.getByRole("button", { name: "New" }).click();
      const create = page.getByRole("dialog", { name: "New group" });
      await create.getByLabel("Name").fill(`Crew ${run}`);
      await create.getByLabel("Timezone").selectOption("Europe/Berlin");
      await create.getByRole("button", { name: "Create group" }).click();

      // Lands on the group page (wait for the destination's heading first: the first hit compiles the route).
      await expect(page.getByRole("heading", { name: `Crew ${run}` })).toBeVisible({ timeout: 15_000 });
      await expect(page).toHaveURL(/\/admin\/groups\/[0-9a-f-]{36}$/);
      await expect(page.getByRole("main").getByText("Europe/Berlin")).toBeVisible();
      await expect(page.getByText("No members")).toBeVisible();

      // Add the member from the picker.
      await settle(page);
      await page.getByRole("button", { name: "Add", exact: true }).click();
      const picker = page.getByRole("dialog", { name: "Add members" });
      await picker.getByText(memberName, { exact: true }).click();
      await expect(picker.getByLabel(memberName)).toBeChecked();
      await picker.getByRole("button", { name: "Add 1 person" }).click();
      await expect(page.getByText("Added 1 member")).toBeVisible();
      await expect(page.getByRole("region", { name: "Members" }).getByText(memberEmail)).toBeVisible();
      await expect(page.getByText("Members · 1")).toBeVisible();

      // Shows up in the list with a count.
      await page.getByRole("link", { name: "All groups" }).click();
      await expect(page).toHaveURL(/\/admin\/groups$/);
      const card = page.getByRole("link", { name: new RegExp(`Crew ${run}`) });
      await expect(card).toContainText("1 member");

      // Remove the member, rename, change timezone.
      await card.click();
      await settle(page);
      await page.getByRole("button", { name: `Remove ${memberName}` }).click();
      await expect(page.getByRole("region", { name: "Members" }).getByText(memberEmail)).toHaveCount(0);
      await expect(page.getByText("Members · 0")).toBeVisible();

      await page.getByRole("button", { name: "Edit" }).click();
      const edit = page.getByRole("dialog", { name: "Edit group" });
      await edit.getByLabel("Name").fill(`Renamed ${run}`);
      await edit.getByLabel("Timezone").selectOption("Asia/Tokyo");
      await edit.getByRole("button", { name: "Save changes" }).click();
      await expect(page.getByRole("heading", { name: `Renamed ${run}` })).toBeVisible();
      await expect(page.getByRole("main").getByText("Asia/Tokyo")).toBeVisible();

      // Name validation is inline.
      await page.getByRole("button", { name: "Edit" }).click();
      await edit.getByLabel("Name").fill("x".repeat(41));
      await edit.getByRole("button", { name: "Save changes" }).click();
      await expect(edit.getByRole("alert")).toContainText("40 characters");
      await page.keyboard.press("Escape");

      // Delete needs confirmation, then returns to the list.
      await page.getByRole("button", { name: "Delete", exact: true }).click();
      await page
        .getByRole("dialog", { name: "Delete group?" })
        .getByRole("button", { name: "Delete group" })
        .click();
      await expect(page).toHaveURL(/\/admin\/groups$/);
      await expect(page.getByRole("link", { name: new RegExp(`Renamed ${run}`) })).toHaveCount(0);
    } finally {
      await member.context.close();
    }
  });

  test("users: deactivate signs the user out; reactivate lets them back", async ({ page, browser, baseURL }) => {
    const victimEmail = `victim-${run}@example.com`;
    const victim = await otherUser(browser, baseURL!, victimEmail, `Victim ${run}`);

    try {
      await victim.page.goto("/home");
      await expect(victim.page).toHaveURL(/\/home$/);

      await page.goto("/admin/users");
      await settle(page);
      const card = page.getByRole("article", { name: `User ${victimEmail}` });
      await expect(card).toContainText("Never synced");
      await expect(card).toContainText("Active");
      await card.getByRole("button", { name: "Deactivate" }).click();
      await page
        .getByRole("dialog", { name: "Deactivate user?" })
        .getByRole("button", { name: "Deactivate" })
        .click();
      await expect(page.getByText("User deactivated")).toBeVisible();
      await expect(card).toContainText("Deactivated");
      await expect(card.getByRole("button", { name: "Reactivate" })).toBeVisible();

      // The victim's session is gone.
      await victim.page.goto("/home");
      await expect(victim.page).toHaveURL(/\/login$/);
      expect((await victim.context.request.get("/api/auth/session")).ok()).toBe(true);
      expect(await (await victim.context.request.get("/api/auth/session")).json()).toBeNull();

      // The admin has no deactivate button on their own card.
      const own = page.getByRole("article", { name: `User ${E2E_ADMIN_EMAIL}` });
      await expect(own).toContainText("Admin");
      await expect(own.getByRole("button")).toHaveCount(0);

      // Reactivate.
      await card.getByRole("button", { name: "Reactivate" }).click();
      await expect(page.getByText("User reactivated")).toBeVisible();
      await expect(card).toContainText("Active");
    } finally {
      await victim.context.close();
    }
  });

  test("section switcher navigates between sections", async ({ page }) => {
    await page.goto("/admin/allowlist");
    await settle(page);
    await page.getByRole("radio", { name: "Groups" }).click();
    await expect(page).toHaveURL(/\/admin\/groups$/);
    await expect(page.getByRole("heading", { name: "Groups" })).toBeVisible();
    await page.getByRole("radio", { name: "Users" }).click();
    await expect(page).toHaveURL(/\/admin\/users$/);
    await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();
  });
});
