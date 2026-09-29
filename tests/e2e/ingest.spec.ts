import { gzipSync } from "node:zlib";
import { expect, request as playwrightRequest, test } from "@playwright/test";
import postgres from "postgres";
import { TEST_DATABASE_URL } from "../support/test-db";
import { loginAs } from "./auth-helpers";

test.setTimeout(120_000);

const stamp = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** POST /api/ingest over real HTTP: JSON, gzip, oversize bodies, and the audit rows. */
test("ingest over HTTP: bearer JSON, gzip, 413 and 401", async ({ page, baseURL }) => {
  const { userId } = await loginAs(page, `e2e-ingest-${stamp()}@example.com`, { name: "Ingest Tester" });
  await page.goto("/profile");
  await page.getByRole("button", { name: "Create key" }).click();
  const value = page.getByTestId("api-key-value");
  await expect(value).toBeVisible();
  const key = ((await value.textContent()) ?? "").trim();
  expect(key).toMatch(/^gk_[A-Za-z0-9_-]{43}$/);

  // A fresh client IP per run, so a reused dev server's per-IP counter doesn't interfere.
  const ip = `198.51.100.${Math.floor(Math.random() * 250) + 1}`;
  const api = await playwrightRequest.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": ip } });
  const sql = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    const today = new Date().toISOString().slice(0, 10);
    const auth = { authorization: `Bearer ${key}` };

    const ok = await api.post("/api/ingest", { headers: auth, data: { date: today, steps: "8,123", mystery: 1 } });
    expect(ok.status()).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, days_written: 1, unknown_fields: ["mystery"] });

    const gz = await api.post("/api/ingest", {
      headers: { ...auth, "content-type": "application/json", "content-encoding": "gzip" },
      data: gzipSync(JSON.stringify({ days: [{ date: today, resting_hr: 51 }] })),
    });
    expect(gz.status()).toBe(200);

    const big = await api.post("/api/ingest", {
      headers: { ...auth, "content-type": "application/json" },
      data: Buffer.alloc(3 * 1024 * 1024 + 10, 0x20),
    });
    expect(big.status()).toBe(413);

    const bad = await api.post("/api/ingest", { headers: { authorization: `Bearer gk_${"Z".repeat(43)}` }, data: { date: today } });
    expect(bad.status()).toBe(401);
    expect(await bad.text()).toBe("");

    expect((await api.get("/api/ingest")).status()).toBe(405);

    const [row] = await sql`select steps, resting_hr from daily_metrics where user_id = ${userId}`;
    expect(row).toEqual({ steps: 8123, resting_hr: 51 });
    const events = await sql`select status, auth_method, summary->>'gzip' as gzip from ingest_events where user_id = ${userId} order by id`;
    expect(events.map((e) => [e.status, e.auth_method, e.gzip])).toEqual([
      [200, "bearer", "false"],
      [200, "bearer", "true"],
      [413, "bearer", "false"],
    ]);
  } finally {
    await api.dispose();
    await sql.end();
  }
});
