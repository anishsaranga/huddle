import { expect, request as playwrightRequest, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { addDays, localParts, todayIn } from "../../src/lib/tz";
import { buildPayload, DEMO_USERS, type DemoUser, type ProfileId } from "../../scripts/seed/generate";
import { TEST_DATABASE_URL } from "../support/test-db";
import { loginAs } from "./auth-helpers";

test.setTimeout(180_000);

const stamp = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/**
 * A timezone where it's currently early afternoon, so "today" has a finished
 * night, a morning resting HR and a few hours of activity whatever time the
 * suite runs.
 */
function afternoonZone(now = new Date()): string {
  const zones = [
    "Pacific/Honolulu",
    "America/Los_Angeles",
    "America/Chicago",
    "America/New_York",
    "America/Sao_Paulo",
    "Atlantic/Azores",
    "UTC",
    "Europe/Berlin",
    "Europe/Istanbul",
    "Asia/Dubai",
    "Asia/Kolkata",
    "Asia/Bangkok",
    "Asia/Tokyo",
    "Australia/Sydney",
    "Pacific/Auckland",
  ];
  return zones.find((tz) => {
    const h = localParts(now.getTime(), tz).hour;
    return h >= 12 && h <= 17;
  })!;
}

/**
 * Signs in a fresh user, creates their API key through the Profile UI and
 * sends `days` days of demo data for `profile` through the real POST
 * /api/ingest (payloads from the dev-seed generator).
 */
async function seedUser(page: Page, baseURL: string | undefined, profile: ProfileId, days: number) {
  const email = `e2e-dash-${profile}-${stamp()}@example.com`;
  const { userId } = await loginAs(page, email, { name: "Dash Tester" });
  const tz = afternoonZone();
  const base = DEMO_USERS.find((u) => u.profile === profile)!;
  const persona: DemoUser = { ...base, email, timezone: tz };

  const sql = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    await sql`update users set timezone = ${tz}, dob = ${persona.dob}, max_hr = ${persona.maxHr},
      sleep_goal_min = ${persona.sleepGoalMin}, step_goal = ${persona.stepGoal} where id = ${userId}`;
  } finally {
    await sql.end();
  }

  await page.goto("/profile");
  await page.getByRole("button", { name: "Create key" }).click();
  const value = page.getByTestId("api-key-value");
  await expect(value).toBeVisible();
  const key = ((await value.textContent()) ?? "").trim();

  const api = await playwrightRequest.newContext({
    baseURL,
    extraHTTPHeaders: { "x-forwarded-for": `198.51.100.${Math.floor(Math.random() * 250) + 1}` },
  });
  try {
    const now = new Date();
    const today = todayIn(tz, now);
    const body = buildPayload(persona, { from: addDays(today, -(days - 1)), to: today, now });
    const res = await api.post("/api/ingest", { headers: { authorization: `Bearer ${key}` }, data: body });
    expect(res.status(), await res.text()).toBe(200);
  } finally {
    await api.dispose();
  }
  return { userId, tz, today: todayIn(tz) };
}

const dial = (page: Page, name: "Recovery" | "Strain" | "Sleep") => page.getByRole("link", { name: new RegExp(`^${name}: `) });

test("home shows real scores; detail screens render; switching day changes URL and values", async ({ page, baseURL }) => {
  const { today } = await seedUser(page, baseURL, "watch", 21);

  await page.goto("/home");
  await expect(page.getByText("TODAY", { exact: true })).toBeVisible();
  await expect(dial(page, "Recovery")).toHaveAccessibleName(/^Recovery: \d{1,2}%/);
  await expect(dial(page, "Strain")).toHaveAccessibleName(/^Strain: \d{1,2}\.\d/);
  await expect(dial(page, "Sleep")).toHaveAccessibleName(/^Sleep: \d{1,3}%/);
  await expect(page.getByRole("heading", { name: "Key stats" })).toBeVisible();
  await expect(page.getByText(/^Synced /)).toBeVisible();
  const todayNames = await Promise.all((["Recovery", "Strain", "Sleep"] as const).map((n) => dial(page, n).getAttribute("aria-label")));

  // Previous day: URL, title and values change.
  const yesterday = addDays(today, -1);
  await page.getByRole("link", { name: "Previous day" }).click();
  await expect(page).toHaveURL(new RegExp(`/home\\?date=${yesterday}$`));
  await expect(page.getByText("YESTERDAY", { exact: true })).toBeVisible();
  // The outgoing dial row pages out; wait until only the new day's row is left.
  await expect(dial(page, "Recovery")).toHaveCount(1);
  await expect
    .poll(async () => (await Promise.all((["Recovery", "Strain", "Sleep"] as const).map((n) => dial(page, n).getAttribute("aria-label")))).join("|"))
    .not.toBe(todayNames.join("|"));
  await expect(dial(page, "Recovery")).toHaveAccessibleName(/^Recovery: \d{1,2}%/);

  // Dials open their detail screen for the same date.
  await dial(page, "Recovery").click();
  await expect(page).toHaveURL(new RegExp(`/recovery\\?date=${yesterday}$`));
  await expect(page.getByRole("heading", { name: "Recovery", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Contributors" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Trend" })).toBeVisible();
  await page.getByRole("radio", { name: "1W" }).click();
  await expect(page.getByRole("radio", { name: "1W" })).toHaveAttribute("aria-checked", "true");
  // Back goes to Home on the same day.
  await page.getByRole("link", { name: "Back to overview" }).click();
  await expect(page).toHaveURL(new RegExp(`/home\\?date=${yesterday}$`));

  await page.goto("/sleep");
  await expect(page.getByRole("heading", { name: "Sleep", level: 1 })).toBeVisible();
  await expect(page.getByRole("img", { name: /^Sleep: \d+%/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Stages" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Score breakdown" })).toBeVisible();
  await page.getByRole("button", { name: /Deep/ }).click();
  await expect(page.getByRole("button", { name: /Deep/ })).toHaveAttribute("aria-pressed", "true");

  await page.goto("/strain");
  await expect(page.getByRole("heading", { name: "Strain", level: 1 })).toBeVisible();
  await expect(page.getByRole("img", { name: /^Strain: \d+\.\d/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Heart rate by hour" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Heart-rate zones" })).toBeVisible();

  // Out-of-range dates clamp instead of erroring.
  await page.goto("/home?date=1999-01-01");
  await expect(page.getByText(new RegExp(`^(SEP|OCT|NOV|DEC|JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG) \\d+$`)).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Previous day" })).toHaveCount(0);
});

test("a brand-new user sees the Connect your iPhone first-run card instead of dials", async ({ page }) => {
  await loginAs(page, `e2e-dash-new-${stamp()}@example.com`, { name: "New Person" });
  await page.goto("/home");
  await expect(page.getByRole("heading", { name: /Connect your\s*iPhone/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Connect your iPhone/ })).toHaveAttribute("href", "/setup");
  await expect(dial(page, "Recovery")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Key stats" })).toHaveCount(0);
  // Detail screens have nothing to show yet either.
  await page.goto("/recovery");
  await expect(page).toHaveURL(/\/home$/);
});

test("an iPhone-only user sees the no-sleep-data states", async ({ page, baseURL }) => {
  await seedUser(page, baseURL, "iphone", 10);

  await page.goto("/home");
  await expect(dial(page, "Sleep")).toHaveAccessibleName(/^Sleep: no score, no sleep data/);
  await expect(dial(page, "Recovery")).toHaveAccessibleName(/^Recovery: no score, needs a tracker/);
  await expect(dial(page, "Strain")).toHaveAccessibleName(/^Strain: \d+\.\d/);
  await expect(page.getByText(/Only time in bed was recorded by your iPhone/)).toBeVisible();

  await page.goto("/sleep");
  await expect(page.getByRole("img", { name: /^Sleep: —, NO SLEEP DATA/ })).toBeVisible();
  await expect(page.getByText("Time in bed only")).toBeVisible();
  await page.goto("/recovery");
  await expect(page.getByText(/an iPhone alone can't measure/)).toBeVisible();
});
