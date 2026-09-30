import { expect, test, type Browser } from "@playwright/test";
import postgres from "postgres";
import { weekStart } from "../../src/lib/scores/period";
import { addDays, todayIn } from "../../src/lib/tz";
import { E2E_ADMIN_EMAIL } from "../support/e2e";
import { TEST_DATABASE_URL } from "../support/test-db";
import { loginAs } from "./auth-helpers";
import { stamp } from "./seed-helpers";

test.setTimeout(180_000);

async function member(browser: Browser, email: string, name: string) {
  const ctx = await browser.newContext({ ...test.info().project.use });
  const page = await ctx.newPage();
  const { userId } = await loginAs(page, email, { name });
  return { ctx, page, userId };
}

test("weekly champions: admin dry run and post, the card in the group chat, flair in Info", async ({ browser, page }) => {
  const s = stamp();
  const ada = await member(browser, `e2e-champ-a-${s}@example.com`, `Ada Champ${s.slice(-3)}`);
  const bo = await member(browser, `e2e-champ-b-${s}@example.com`, `Bo Runner${s.slice(-3)}`);
  await loginAs(page, E2E_ADMIN_EMAIL, { name: "Admin E2E" });

  // A UTC group whose last completed week has 5 days of scores for both members (Ada sleeps better, Bo strains more).
  const lastWeek = addDays(weekStart(todayIn("UTC")), -7);
  const sql = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  let groupId: string;
  try {
    [{ id: groupId }] = await sql<{ id: string }[]>`insert into groups (name, timezone) values (${`Champs ${s}`}, 'UTC') returning id`;
    await sql`insert into group_members (group_id, user_id) values (${groupId}, ${ada.userId}), (${groupId}, ${bo.userId})`;
    for (let i = 0; i < 5; i++) {
      const d = addDays(lastWeek, i);
      await sql`insert into daily_scores (user_id, local_date, sleep_score, recovery, strain, components)
        values (${ada.userId}, ${d}, 92, 81, 9.5, '{}'::jsonb), (${bo.userId}, ${d}, 71, 64, 16.2, '{}'::jsonb)`;
      await sql`insert into daily_metrics (user_id, local_date, steps) values (${ada.userId}, ${d}, 9000), (${bo.userId}, ${d}, 15000)`;
    }
  } finally {
    await sql.end();
  }

  // Admin: dry run shows the facts and the text, and posts nothing.
  await page.goto(`/admin/groups/${groupId}`);
  const panel = page.getByRole("region", { name: "Weekly champions" });
  await expect(panel.getByTestId("champions-last-post")).toHaveText("Never");
  await panel.getByRole("button", { name: "Dry run" }).click();
  const dry = panel.getByTestId("champions-dry-run");
  await expect(dry).toBeVisible();
  await expect(dry).toContainText("TEMPLATE"); // no Gemini key on the e2e server
  await expect(dry).toContainText(`Ada Champ${s.slice(-3)}`);
  await expect(dry).toContainText("NOTHING WAS POSTED");
  await expect(panel.getByTestId("worker-job-champions")).toBeVisible();
  await expect(panel.getByTestId("worker-job-retention")).toBeVisible();

  // Post now, behind a confirmation; a second post is refused as "Already posted".
  await panel.getByRole("button", { name: "Post now" }).click();
  await page.getByRole("button", { name: "Post to the group" }).click();
  await expect(page.getByText("Champions posted to the group chat")).toBeVisible();
  await expect(panel.getByTestId("champions-last-post")).not.toHaveText("Never");
  await panel.getByRole("button", { name: "Post now" }).click();
  await page.getByRole("button", { name: "Post to the group" }).click();
  await expect(page.getByText("Already posted for that week")).toBeVisible();

  // A member sees the card in the chat, with the winners.
  await bo.page.goto(`/groups/${groupId}?tab=chat`);
  const card = bo.page.getByTestId("champions-card");
  await expect(card).toBeVisible();
  await expect(card).toContainText("WEEKLY CHAMPIONS");
  await expect(card.locator('[data-category="sleep"]')).toContainText(`Ada Champ${s.slice(-3)}`);
  await expect(card.locator('[data-category="strain"]')).toContainText(`Bo Runner${s.slice(-3)}`);
  await expect(bo.page.getByTestId("champions-card")).toHaveCount(1);

  // Tapping a category opens that week's board.
  await card.getByRole("button", { name: /^Best sleep:/ }).click();
  await expect(bo.page.getByRole("tab", { name: "Sleep" })).toHaveAttribute("aria-selected", "true");
  await expect(bo.page).toHaveURL(/tab=sleep/);
  await expect(bo.page).toHaveURL(/period=week/);

  // Flair: the winners wear a trophy on their Info rows.
  await ada.page.goto(`/groups/${groupId}`);
  const adaRow = ada.page.getByRole("button", { name: new RegExp(`^Ada Champ${s.slice(-3)}\\. Weekly champion: .*Best sleep`) });
  await expect(adaRow).toBeVisible();
  await expect(adaRow.getByTestId("champion-flair")).toBeVisible();
  const boRow = ada.page.getByRole("button", { name: new RegExp(`^Bo Runner${s.slice(-3)}\\. Weekly champion: .*Highest strain`) });
  await expect(boRow.getByTestId("champion-flair")).toBeVisible();

  await ada.ctx.close();
  await bo.ctx.close();
});
