import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { TEST_DATABASE_URL } from "../support/test-db";
import { loginAs } from "./auth-helpers";
import { afternoonZone, seedUser, stamp } from "./seed-helpers";

test.setTimeout(240_000);

test("community: group list, Info, a strain podium, Day/Week in the URL, and 404 for non-members", async ({ page, baseURL }) => {
  const tz = afternoonZone();
  const people = [
    { name: "Ava Stone", profile: "watch" as const },
    { name: "Ben Ortiz", profile: "fitbit" as const },
    { name: "Cleo Park", profile: "watch" as const },
  ];
  // Three friends, each with three weeks of data sent through the real POST /api/ingest.
  const seeded = [];
  for (const p of people) seeded.push(await seedUser(page, baseURL, p.profile, 21, { emailPrefix: "e2e-grp", name: p.name, tz }));

  const groupName = `Crew ${stamp()}`;
  const sql = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  let groupId: string;
  try {
    [{ id: groupId }] = await sql<{ id: string }[]>`insert into groups (name, timezone) values (${groupName}, ${tz}) returning id`;
    for (const s of seeded) await sql`insert into group_members (group_id, user_id) values (${groupId}, ${s.userId})`;
  } finally {
    await sql.end();
  }

  // Back to the first friend.
  await loginAs(page, seeded[0].email, { name: people[0].name });

  // /groups lists the group; tapping opens it.
  await page.goto("/groups");
  const card = page.getByRole("link", { name: new RegExp(`^${groupName}, 3 members`) });
  await expect(card).toBeVisible();
  await expect(card).toHaveAccessibleName(/3 of 3 synced today/);
  await card.click();
  await expect(page).toHaveURL(new RegExp(`/groups/${groupId}$`));
  await expect(page.getByRole("heading", { name: groupName, level: 1 })).toBeVisible();

  // Info: every member is listed with today's scores.
  const info = page.getByRole("tabpanel", { name: "Info" });
  for (const p of people) await expect(info.getByRole("button", { name: new RegExp(`^${p.name}\\. Today: `) })).toBeVisible();
  await info.getByRole("button", { name: /^Ben Ortiz\./ }).click();
  await expect(page.getByRole("dialog", { name: "Ben Ortiz" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Deep link to the strain board: a podium with all three.
  await page.goto(`/groups/${groupId}?tab=strain`);
  await expect(page.getByRole("tab", { name: "Strain" })).toHaveAttribute("aria-selected", "true");
  const strain = page.getByRole("tabpanel", { name: "Strain" });
  const podium = strain.getByRole("list", { name: "Top 3" });
  await expect(podium.getByRole("listitem")).toHaveCount(3);
  for (const p of people) await expect(podium.getByRole("img", { name: new RegExp(`^${p.name.split(" ")[0]}, rank [123]$`) })).toBeVisible();
  await expect(strain.getByText("TODAY", { exact: true })).toBeVisible();

  // Day -> Week: the URL and the board change, the page stays on the strain tab.
  await strain.getByRole("radio", { name: "Week" }).click();
  await expect(page).toHaveURL(new RegExp(`/groups/${groupId}\\?tab=strain&period=week$`));
  await expect(strain.getByRole("radio", { name: "Week" })).toHaveAttribute("aria-checked", "true");
  await expect(strain.getByText("THIS WEEK", { exact: true })).toBeVisible();
  // Week entries show how many days they're based on (ranked or "not enough data").
  await expect(strain.getByText(/^\d\/7 DAYS$/).first()).toBeVisible();
  await strain.getByRole("button", { name: "Previous week" }).click();
  await expect(page).toHaveURL(/period=week&date=\d{4}-\d{2}-\d{2}$/);
  await expect(strain.getByText("LAST WEEK", { exact: true })).toBeVisible();
  await expect(strain.getByRole("list", { name: "Top 3" }).getByRole("listitem")).toHaveCount(3);
  await strain.getByRole("radio", { name: "Day" }).click();
  await expect(page).toHaveURL(/\?tab=strain&date=\d{4}-\d{2}-\d{2}$/);

  // Swiping / tapping tabs updates ?tab= without a reload.
  await page.getByRole("tab", { name: "Sleep" }).click();
  await expect(page).toHaveURL(/\?tab=sleep&date=/);

  // Someone outside the group gets a 404 (same as a missing group).
  await loginAs(page, `e2e-grp-outsider-${stamp()}@example.com`, { name: "Outsider" });
  const res = await page.goto(`/groups/${groupId}`);
  expect(res?.status()).toBe(404);
  await page.goto("/groups");
  await expect(page.getByText(/You're not in a group yet/)).toBeVisible();
});
