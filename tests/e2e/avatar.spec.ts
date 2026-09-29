import { expect, test } from "@playwright/test";
import { loginAs } from "./auth-helpers";

test.describe("/api/avatar/[userId]", () => {
  test("401s without a session", async ({ request }) => {
    const res = await request.get("/api/avatar/00000000-0000-4000-8000-000000000000");
    expect(res.status()).toBe(401);
  });

  test("serves an SVG with an ETag, then 304s", async ({ page }) => {
    const { userId } = await loginAs(page, "e2e-avatar@example.com");
    const res = await page.request.get(`/api/avatar/${userId}`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("image/svg+xml");
    const etag = res.headers()["etag"];
    expect(etag).toMatch(/^"d-[0-9a-f]{16}-svg"$/);
    expect((await res.text()).startsWith("<svg")).toBe(true);

    const again = await page.request.get(`/api/avatar/${userId}`, { headers: { "if-none-match": etag } });
    expect(again.status()).toBe(304);

    const png = await page.request.get(`/api/avatar/${userId}?format=png&size=64`);
    expect(png.status()).toBe(200);
    expect(png.headers()["content-type"]).toBe("image/png");
  });
});

test("credits page lists every avatar style publicly", async ({ page }) => {
  await page.goto("/credits");
  await expect(page.getByRole("heading", { name: "Credits" })).toBeVisible();
  for (const name of ["Adventurer", "Avataaars", "Micah", "Toon Head", "Personas", "Open Peeps", "Lorelei"]) {
    await expect(page.getByRole("heading", { name })).toBeVisible();
  }
  await expect(page.getByText("CC BY 4.0").first()).toBeVisible();
});

test("customizer: pick, undo, switch style, randomize", async ({ page }) => {
  await page.goto("/dev/ui");
  const section = page.locator("#avatars");
  const json = section.locator("pre");
  await section.locator("summary").click();
  const read = async () => JSON.parse((await json.textContent()) ?? "{}");
  const start = await read();

  // Pick a different mouth.
  await section.getByRole("tab", { name: "Mouth", exact: true }).click();
  const tiles = section.getByRole("tabpanel").getByRole("radio");
  const unselected = tiles.and(page.locator('[aria-checked="false"]')).first();
  await unselected.click();
  await expect.poll(async () => (await read()).options.mouth).not.toBe(start.options.mouth);

  // Undo restores it.
  await section.getByRole("button", { name: "Undo" }).click();
  await expect.poll(async () => (await read()).options.mouth).toBe(start.options.mouth);

  // Switch style keeps the seed.
  await section.getByRole("radio", { name: "Lorelei style" }).click();
  await expect.poll(async () => (await read()).style).toBe("lorelei");
  expect((await read()).seed).toBe(start.seed);

  // Randomize lands on a new config after the shuffle.
  const before = JSON.stringify(await read());
  await section.getByRole("button", { name: "Randomize" }).click();
  await expect.poll(async () => JSON.stringify(await read()), { timeout: 5000 }).not.toBe(before);
  expect((await read()).style).toBe("lorelei");
});
