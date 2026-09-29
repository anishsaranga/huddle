import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";
import { loginAs } from "./auth-helpers";

// First hits compile the customizer chunk in `next dev`, so give the flow room.
test.setTimeout(150_000);

/** Unique per run: the e2e database is not truncated between runs. */
const stamp = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

async function startOnboarding(page: Page) {
  const id = stamp();
  const email = `e2e-onb-${id}@example.com`;
  const { userId } = await loginAs(page, email, { onboarded: false, name: "Sam Rivera" });
  await page.goto("/home");
  // A signed-in but not-onboarded user is sent to /onboarding.
  await expect(page).toHaveURL(/\/onboarding$/);
  return { id, email, userId, username: `onb_${id}`.slice(0, 20) };
}

async function next(page: Page) {
  await page.getByRole("button", { name: "Continue" }).click();
}

async function stepIdentity(page: Page, username: string) {
  await expect(page.getByRole("heading", { name: "Who are you?" })).toBeVisible();
  await page.getByLabel("Username").fill(username);
  await expect(page.getByText(`@${username} is available`)).toBeVisible();
  await next(page);
}

async function stepBasics(page: Page) {
  await expect(page.getByRole("heading", { name: "The basics" })).toBeVisible();
  await page.getByRole("radio", { name: "Metric" }).click();
  await page.getByLabel("Date of birth").fill("1994-03-12");
  await page.getByRole("radio", { name: "Female" }).click();
  await next(page);
}

async function stepBodyGoals(page: Page) {
  await expect(page.getByRole("heading", { name: "Your body" })).toBeVisible();
  await page.getByLabel("Height").fill("172");
  await page.getByLabel("Weight").fill("64.5");
  await next(page);

  await expect(page.getByRole("heading", { name: "Set your goals" })).toBeVisible();
  await expect(page.getByText("8,000")).toBeVisible();
  await next(page);

  await expect(page.getByRole("heading", { name: "You’re in" })).toBeVisible();
}

async function finish(page: Page) {
  await page.getByRole("button", { name: "Finish" }).click();
  await expect(page).toHaveURL(/\/home$/);
}

test("redirects to onboarding, completes every step with a built character, lands on /home", async ({ page }) => {
  const { username } = await startOnboarding(page);
  await stepIdentity(page, username);

  // Avatar: build a character, randomize once.
  await expect(page.getByRole("heading", { name: "Make it yours" })).toBeVisible();
  const randomize = page.getByRole("button", { name: "Randomize" });
  await expect(randomize).toBeVisible({ timeout: 60_000 }); // dynamic chunk
  await randomize.click();
  await next(page);

  await stepBasics(page);
  await stepBodyGoals(page);
  await finish(page);

  // Onboarded users no longer see /onboarding.
  await page.goto("/onboarding");
  await expect(page).toHaveURL(/\/home$/);

  // Profile shows what was entered.
  await page.goto("/profile");
  await expect(page.getByRole("heading", { level: 1, name: "Sam Rivera" })).toBeVisible();
  await expect(page.getByText(`@${username}`).first()).toBeVisible();
  await expect(page.getByText("172 cm")).toBeVisible();
  await expect(page.getByText("8h 00m")).toBeVisible();
});

test("photo upload path: pick, crop, save, continue and finish", async ({ page }) => {
  const { userId, username } = await startOnboarding(page);
  await stepIdentity(page, username);

  await page.getByRole("radio", { name: "Upload photo" }).click();
  const png = await sharp({ create: { width: 900, height: 600, channels: 3, background: "#3d9bff" } }).png().toBuffer();
  await page.getByTestId("avatar-file-input").setInputFiles({ name: "me.png", mimeType: "image/png", buffer: png });

  const crop = page.getByRole("dialog", { name: "Adjust photo" });
  await expect(crop).toBeVisible();
  await crop.getByRole("slider", { name: "Zoom" }).fill("2");
  await crop.getByRole("button", { name: "Use photo" }).click();
  await expect(crop).toBeHidden();
  await expect(page.getByRole("button", { name: "Replace photo" })).toBeVisible();
  await next(page);

  await stepBasics(page);
  await stepBodyGoals(page);
  await finish(page);

  // The stored photo is a 512x512 WebP served through the avatar route.
  const res = await page.request.get(`/api/avatar/${userId}`);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("image/webp");
  const meta = await sharp(await res.body()).metadata();
  expect([meta.width, meta.height]).toEqual([512, 512]);
});

test("photo upload rejects a non-image with a friendly message", async ({ page }) => {
  const { username } = await startOnboarding(page);
  await stepIdentity(page, username);
  await page.getByRole("radio", { name: "Upload photo" }).click();
  await page.getByTestId("avatar-file-input").setInputFiles({
    name: "notes.png",
    mimeType: "image/png",
    buffer: Buffer.from("definitely not an image"),
  });
  const crop = page.getByRole("dialog", { name: "Adjust photo" });
  await expect(crop.getByText(/couldn.t read that image/i)).toBeVisible();
});

test("username feedback: reserved, taken, and refresh resumes at the first incomplete step", async ({ page, request }) => {
  // Someone else already owns this username.
  const takenId = stamp();
  const ownerEmail = `own-${takenId}@example.com`;
  // A separate API context: its session cookie never reaches the page under test.
  await request.post("/api/test/login", { data: { email: ownerEmail, name: "Owner", onboarded: true } });
  const ownerUsername = ownerEmail.split("@")[0].replace(/[^a-z0-9_]/g, "_").slice(0, 24);

  const { username } = await startOnboarding(page);
  const field = page.getByLabel("Username");

  await field.fill("admin");
  await expect(page.getByText("That username is reserved")).toBeVisible();

  await field.fill("no spaces");
  await expect(page.getByText("Letters, numbers and underscores only")).toBeVisible();

  await field.fill(ownerUsername);
  await expect(page.getByText("That username is taken")).toBeVisible();
  await next(page);
  await expect(page.getByRole("heading", { name: "Who are you?" })).toBeVisible(); // did not advance

  await field.fill(username);
  await expect(page.getByText(`@${username} is available`)).toBeVisible();
  await next(page);
  await expect(page.getByRole("heading", { name: "Make it yours" })).toBeVisible();

  // Reload: the identity step was saved server-side, so we resume at the avatar step.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Make it yours" })).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByLabel("Username")).toHaveValue(username);
});

test("validation blocks under-13 birthdays", async ({ page }) => {
  const { username } = await startOnboarding(page);
  await stepIdentity(page, username);
  await expect(page.getByRole("radio", { name: "Build a character" })).toBeVisible();
  await next(page);

  await expect(page.getByRole("heading", { name: "The basics" })).toBeVisible();
  const year = new Date().getFullYear() - 8;
  await page.getByLabel("Date of birth").fill(`${year}-01-01`);
  await page.getByRole("radio", { name: "Male", exact: true }).click();
  await next(page);
  await expect(page.getByText(/at least 13/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "The basics" })).toBeVisible();
});

test("profile: editing the display name persists", async ({ page }) => {
  // Keep the derived username under the 20-char limit so the Personal form validates.
  await loginAs(page, `pf-${stamp()}@example.com`, { name: "Old Name" });
  await page.goto("/profile");
  await expect(page.getByRole("heading", { level: 1, name: "Old Name" })).toBeVisible();

  await page.getByRole("button", { name: "Edit personal" }).click();
  const name = page.getByLabel("Display name");
  await expect(name).toHaveValue("Old Name");
  await name.fill("Brand New Name");
  // Test-login users have no DOB/sex yet, so complete the section.
  await page.getByLabel("Date of birth").fill("1990-06-15");
  await page.getByRole("radio", { name: "Prefer not to say" }).click();
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByText("Saved")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Brand New Name" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Brand New Name" })).toBeVisible();
  await expect(page.getByText("15 Jun 1990")).toBeVisible();
});

test("profile: sections, links and placeholder rows", async ({ page }) => {
  await loginAs(page, `e2e-links-${stamp()}@example.com`);
  await page.goto("/profile");
  for (const name of ["Edit personal", "Edit body", "Edit goals", "Edit preferences", "Edit avatar"]) {
    await expect(page.getByRole("button", { name })).toBeVisible();
  }
  await expect(page.getByRole("link", { name: /Sync setup/ })).toHaveAttribute("href", "/setup");
  await expect(page.getByRole("link", { name: /Avatar credits/ })).toHaveAttribute("href", "/credits");
  for (const label of ["API key", "Export my data", "Delete account"]) {
    await expect(page.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();

  await page.getByRole("link", { name: /Sync setup/ }).click();
  await expect(page.getByRole("heading", { name: "Sync setup" })).toBeVisible();
});
