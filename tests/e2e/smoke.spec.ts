import { test, expect } from "@playwright/test";

test("home page loads and displays Recovery text", async ({ page }) => {
  await page.goto("/home");
  await expect(page).toHaveTitle(/Recovery|Home|Huddle/i);
  await expect(page.locator("text=Recovery")).toBeVisible();
});

test("home page has tab bar link to groups", async ({ page }) => {
  await page.goto("/home");
  const groupsLink = page.locator("a[href='/groups']");
  await expect(groupsLink).toBeVisible();
});
