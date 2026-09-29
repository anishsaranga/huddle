import { test, expect } from "@playwright/test";
import { loginAs } from "./auth-helpers";

test.describe("signed out", () => {
  test("app pages redirect to /login", async ({ page }) => {
    await page.goto("/home");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("protected APIs return 401", async ({ request }) => {
    const res = await request.get("/api/me");
    expect(res.status()).toBe(401);
  });

  test("login page shows the Google button", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Huddle" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  });

  test("Continue with Google without credentials fails gracefully", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Continue with Google" }).click();
    await expect(page).toHaveURL(/\/login\?error=Configuration$/);
    await expect(page.getByText("Sign-in isn't set up yet")).toBeVisible();
  });

  test("denied page asks for the admin", async ({ page }) => {
    await page.goto("/denied");
    await expect(page.getByRole("heading", { name: /not on the list/i })).toBeVisible();
    await expect(page.getByText("Ask the admin to add you.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Try another account" })).toBeVisible();
  });

  test("a bogus session cookie is not enough", async ({ page, context, baseURL }) => {
    await context.addCookies([
      { name: "authjs.session-token", value: "not-a-real-session", url: baseURL! },
    ]);
    await page.goto("/home");
    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe("signed in", () => {
  test("/login bounces a signed-in user to /home", async ({ page }) => {
    await loginAs(page);
    await page.goto("/login");
    await expect(page).toHaveURL(/\/home$/);
  });

  test("Auth.js session exposes Huddle's user fields", async ({ page }) => {
    const { userId } = await loginAs(page, "e2e-session@example.com", { name: "Session Tester" });
    const res = await page.request.get("/api/auth/session");
    expect(res.ok()).toBe(true);
    const session = await res.json();
    expect(session.user).toMatchObject({
      id: userId,
      email: "e2e-session@example.com",
      displayName: "Session Tester",
      isAdmin: false,
      onboarded: true,
    });
  });

  test("users who haven't onboarded land on /onboarding", async ({ page }) => {
    await loginAs(page, "e2e-new@example.com", { onboarded: false });
    await page.goto("/home");
    await expect(page).toHaveURL(/\/onboarding$/);
    await expect(page.getByRole("heading", { name: "Welcome" })).toBeVisible();
  });

  test("sign out from Profile returns to /login", async ({ page }) => {
    await loginAs(page, "e2e-signout@example.com", { name: "Sign Out Tester" });
    await page.goto("/profile");
    await expect(page.getByText("e2e-signout@example.com")).toBeVisible();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto("/home");
    await expect(page).toHaveURL(/\/login$/);
  });
});
