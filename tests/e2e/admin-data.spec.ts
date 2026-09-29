import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { E2E_ADMIN_EMAIL } from "../support/e2e";
import { TEST_DATABASE_URL } from "../support/test-db";
import { loginAs } from "./auth-helpers";

// The users and events below are shared by every test in this file.
test.describe.configure({ mode: "serial" });

const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 4)}`;
const NAME = `Data Tester ${run}`;
const EMAIL = `data-${run}@example.com`;

let userId = "";

const isoDaysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

test.beforeAll(async ({ browser, baseURL }) => {
  const ctx = await browser.newContext({ baseURL });
  const page = await ctx.newPage();
  userId = (await loginAs(page, EMAIL, { name: NAME })).userId;
  const plain = await ctx.newPage();
  await loginAs(plain, `data-plain-${run}@example.com`);
  await ctx.close();

  const sql = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    // Steps every day, resting HR every other day (last 30 UTC days). Timezone is unset, so UTC.
    for (let i = 0; i < 30; i++) {
      await sql`insert into daily_metrics (user_id, local_date, steps, resting_hr)
        values (${userId}, ${isoDaysAgo(i)}, 8000, ${i % 2 === 0 ? 52 : null}) on conflict do nothing`;
    }
    const inventory = {
      perDay: { [isoDaysAgo(1)]: { present: ["steps", "resting_hr"], nulls: ["hrv_sdnn_ms"], absent: ["vo2max", "weight_kg"] } },
      totals: {},
    };
    const summary = (extra: object = {}) => ({
      days: 3,
      dateRange: { from: isoDaysAgo(3), to: isoDaysAgo(1) },
      rowsInserted: 2,
      rowsUpdated: 1,
      tz: "UTC",
      tzSource: "profile",
      ...extra,
    });
    // 27 events so there are two pages (25 + 2): #0 is the newest.
    for (let i = 0; i < 27; i++) {
      const ok = i !== 3;
      await sql`insert into ingest_events (user_id, received_at, status, auth_method, bytes, duration_ms, summary, body, errors)
        values (
          ${userId}, now() - ${i * 5} * interval '1 minute', ${ok ? 200 : 400}, 'bearer', ${2048 + i}, ${40 + i},
          ${sql.json(
            ok
              ? summary({ fields: inventory, unknownFields: { cycling_km: { count: 2, types: ["number"] } }, sleepSources: { "Apple Watch": ["core", "deep"] } })
              : summary(),
          )},
          ${sql.json({ tz: "UTC", days: [{ date: isoDaysAgo(1), steps: 8000, marker: `body-${i}` }] })},
          ${ok ? null : sql.json({ reason: "validation", issues: [{ path: ["days", 0, "steps"], message: "expected a number" }] })}
        )`;
    }
  } finally {
    await sql.end();
  }
});

test.describe("non-admins", () => {
  test("get a 404 for the data pages", async ({ page }) => {
    await loginAs(page, `data-plain-${run}@example.com`);
    for (const path of ["/admin/data", `/admin/data/${userId}`]) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(404);
    }
  });
});

test.describe("admin", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, E2E_ADMIN_EMAIL, { name: "Admin E2E" });
  });

  test("Data tab shows the coverage grid with a row per user, and the cell detail", async ({ page }) => {
    await page.goto("/admin/allowlist");
    await page.waitForLoadState("networkidle");
    await page.getByRole("radio", { name: "Data" }).click();
    await expect(page).toHaveURL(/\/admin\/data$/);
    await expect(page.getByRole("heading", { name: "Data coverage" })).toBeVisible();

    const grid = page.getByRole("table", { name: /Data coverage, last 30 days/ });
    await expect(grid).toBeVisible();
    await expect(grid.getByRole("row", { name: `Coverage for ${NAME}` })).toBeVisible();
    // The admin and the plain user are rows too.
    await expect(grid.getByRole("row", { name: "Coverage for Admin E2E" })).toBeVisible();

    // Steps 30/30 days, resting HR 15/30 (every other day), HRV never.
    await expect(page.getByRole("button", { name: `${NAME}, Steps: 100%` })).toBeVisible();
    await expect(page.getByRole("button", { name: `${NAME}, Resting heart rate: 50%` })).toBeVisible();
    await expect(page.getByRole("button", { name: `${NAME}, Heart rate variability (SDNN): 0%` })).toBeVisible();

    await page.getByRole("button", { name: `${NAME}, Resting heart rate: 50%` }).click();
    const sheet = page.getByRole("dialog", { name: "Resting heart rate" });
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText(NAME);
    await expect(sheet).toContainText("15 / 30 days");
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();

    // Legend and the other sections.
    await expect(page.getByText("% of last 30 days with a value")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Unknown fields" })).toBeVisible();
    await expect(page.getByTestId("unknown-field").filter({ hasText: "cycling_km" })).toContainText(NAME);
    await expect(page.getByRole("heading", { name: "Sleep sources" })).toBeVisible();
    await expect(page.getByRole("article", { name: `Sleep sources for ${NAME}` })).toContainText("Apple Watch");
  });

  test("a user's ingest log: events, expanding shows the field inventory and the raw body", async ({ page }) => {
    await page.goto("/admin/data");
    await page.waitForLoadState("networkidle");
    await page.getByRole("link", { name: `Ingest log for ${NAME}` }).first().click();
    await expect(page).toHaveURL(new RegExp(`/admin/data/${userId}$`));
    await expect(page.getByRole("heading", { name: NAME })).toBeVisible();

    const events = page.getByTestId("ingest-event");
    await expect(events).toHaveCount(25);
    await expect(events.first()).toContainText("200");
    await expect(events.first()).toContainText("bearer");
    await expect(events.first()).toContainText("2 new");

    // Expand: the per-day inventory loads on demand.
    await events.first().getByRole("button").first().click();
    await expect(events.first().getByTestId("inventory-present")).toContainText("steps");
    await expect(events.first().getByTestId("inventory-nulls")).toContainText("hrv_sdnn_ms");
    await expect(events.first().getByTestId("inventory-absent")).toContainText("vo2max");
    await expect(events.first()).toContainText("cycling_km");

    // Raw body: collapsed until asked, then pretty-printed with a copy button.
    await expect(events.first().getByTestId("raw-body")).toHaveCount(0);
    await events.first().getByRole("button", { name: "Show body" }).click();
    const body = events.first().getByTestId("raw-body");
    await expect(body).toContainText('"marker": "body-0"');
    await expect(events.first().getByRole("button", { name: "Copy body" })).toBeVisible();

    // The rejected request (#3) shows its status, error and no inventory.
    const failed = page.locator("[data-testid=ingest-event][data-status='400']");
    await expect(failed).toHaveCount(1);
    await failed.getByRole("button").first().click();
    await expect(failed).toContainText("expected a number");

    // Pagination: page 2 holds the last two events.
    await page.getByRole("link", { name: "Older" }).click();
    await expect(page).toHaveURL(/page=2/);
    await expect(page.getByTestId("ingest-event")).toHaveCount(2);
    await expect(page.getByText("Page 2 of 2")).toBeVisible();
  });

  test("status filter narrows the log to errors", async ({ page }) => {
    await page.goto(`/admin/data/${userId}`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("radio", { name: "Errors" }).click();
    await expect(page).toHaveURL(/status=errors/);
    await expect(page.getByTestId("ingest-event")).toHaveCount(1);
    await expect(page.getByTestId("ingest-event")).toHaveAttribute("data-status", "400");
    await page.getByRole("radio", { name: "OK", exact: true }).click();
    await expect(page).toHaveURL(/status=ok/);
    await expect(page.getByTestId("ingest-event")).toHaveCount(25);
    await page.getByRole("radio", { name: "All", exact: true }).click();
    await expect(page).not.toHaveURL(/status=/);
    // A made-up user id shows the 404 page (the status is already 200 once the loading state has streamed).
    await page.goto("/admin/data/00000000-0000-4000-8000-000000000000");
    await expect(page.getByText("This page could not be found")).toBeVisible();
    await page.goto("/admin/data/not-a-uuid");
    await expect(page.getByText("This page could not be found")).toBeVisible();
  });
});
