import { expect, request as playwrightRequest, type Page } from "@playwright/test";
import postgres from "postgres";
import { addDays, localParts, todayIn } from "../../src/lib/tz";
import { buildPayload, DEMO_USERS, withTrackedNight, type DemoUser, type ProfileId } from "../../scripts/seed/generate";
import { TEST_DATABASE_URL } from "../support/test-db";
import { loginAs } from "./auth-helpers";

export const stamp = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/**
 * A timezone where it's currently early afternoon, so "today" has a finished
 * night, a morning resting HR and a few hours of activity whatever time the
 * suite runs.
 */
export function afternoonZone(now = new Date()): string {
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
 * Signs in a fresh user on `page`, creates their API key through the Profile
 * UI and sends `days` days of demo data for `profile` through the real POST
 * /api/ingest (payloads from the dev-seed generator).
 *
 * The night that ended this morning is always tracked (`withTrackedNight`):
 * the generator leaves a few percent of nights out on purpose, and with a
 * fresh email (its PRNG seed) every run, "today" would otherwise have no sleep
 * now and then.
 */
export async function seedUser(
  page: Page,
  baseURL: string | undefined,
  profile: ProfileId,
  days: number,
  opts: { emailPrefix?: string; name?: string; tz?: string } = {},
) {
  // The stamp goes first: the test login derives the (unique) username from the
  // first 24 characters of the email, which used to cut off the stamp's random
  // end, so two workers signing up in the same millisecond collided.
  const email = `${opts.emailPrefix ?? "e2e-dash"}-${stamp()}-${profile}@example.com`;
  const { userId } = await loginAs(page, email, { name: opts.name ?? "Dash Tester" });
  const tz = opts.tz ?? afternoonZone();
  const base = DEMO_USERS.find((u) => u.profile === profile)!;

  const sql = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    await sql`update users set timezone = ${tz}, dob = ${base.dob}, max_hr = ${base.maxHr},
      sleep_goal_min = ${base.sleepGoalMin}, step_goal = ${base.stepGoal} where id = ${userId}`;
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
  const now = new Date();
  const today = todayIn(tz, now);
  try {
    const persona: DemoUser = withTrackedNight({ ...base, email, timezone: tz }, today);
    const body = buildPayload(persona, { from: addDays(today, -(days - 1)), to: today, now });
    const res = await api.post("/api/ingest", { headers: { authorization: `Bearer ${key}` }, data: body });
    expect(res.status(), await res.text()).toBe(200);
  } finally {
    await api.dispose();
  }
  return { userId, email, tz, today };
}
