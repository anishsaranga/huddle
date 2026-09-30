import { expect, test, type Browser, type Page } from "@playwright/test";
import postgres from "postgres";
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

const chat = (page: Page) => page.getByRole("log", { name: /chat$/ });
const composer = (page: Page) => page.getByRole("textbox", { name: "Message" });

async function send(page: Page, text: string) {
  await composer(page).fill(text);
  await page.getByRole("button", { name: "Send" }).click();
}

test("chat: live messages and reactions across two sessions, safe rendering, members-only stream", async ({ browser }) => {
  const s = stamp();
  const a = await member(browser, `e2e-chat-a-${s}@example.com`, "Ada Chat");
  const b = await member(browser, `e2e-chat-b-${s}@example.com`, "Bo Chat");
  const outsider = await member(browser, `e2e-chat-x-${s}@example.com`, "Xavi Out");

  const groupName = `Chat ${s}`;
  const sql = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  let groupId: string;
  try {
    [{ id: groupId }] = await sql<{ id: string }[]>`insert into groups (name, timezone) values (${groupName}, 'UTC') returning id`;
    await sql`insert into group_members (group_id, user_id) values (${groupId}, ${a.userId}), (${groupId}, ${b.userId})`;
  } finally {
    await sql.end();
  }

  // Both open the chat tab; the empty state greets them.
  await a.page.goto(`/groups/${groupId}?tab=chat`);
  await expect(a.page.getByRole("tab", { name: /^Chat/ })).toHaveAttribute("aria-selected", "true");
  await expect(chat(a.page).getByText(`Say hi to ${groupName}`)).toBeVisible();
  // (Anything sent before B's stream is live is replayed from ?after=, so no need to wait for it.)
  await b.page.goto(`/groups/${groupId}?tab=chat`);
  await expect(chat(b.page)).toBeVisible();

  // A sends; B sees it live, without a reload.
  await send(a.page, "Morning crew! Long run at 7?");
  await expect(chat(a.page).getByText("Morning crew! Long run at 7?")).toBeVisible();
  await expect(chat(b.page).getByText("Morning crew! Long run at 7?")).toBeVisible({ timeout: 15_000 });
  await expect(chat(b.page).getByText("Ada Chat")).toBeVisible();

  // B reacts through the long-press menu (right-click on desktop); A sees the chip live.
  await chat(b.page).getByTestId("chat-bubble").filter({ hasText: "Long run at 7?" }).click({ button: "right" });
  const menu = b.page.getByRole("dialog", { name: "Message actions" });
  await expect(menu).toBeVisible();
  await menu.getByRole("button", { name: "React with 🔥" }).click();
  await expect(menu).toHaveCount(0);
  await expect(chat(b.page).getByRole("button", { name: /^🔥 1, including you/ })).toBeVisible();
  await expect(chat(a.page).getByRole("button", { name: /^🔥 1\. Tap to add yours/ })).toBeVisible({ timeout: 15_000 });

  // A adds the same reaction by tapping the chip: both see 2.
  await chat(a.page).getByRole("button", { name: /^🔥 1\./ }).click();
  await expect(chat(a.page).getByRole("button", { name: /^🔥 2, including you/ })).toBeVisible();
  await expect(chat(b.page).getByRole("button", { name: /^🔥 2, including you/ })).toBeVisible({ timeout: 15_000 });
  // B toggles theirs off.
  await chat(b.page).getByRole("button", { name: /^🔥 2/ }).click();
  await expect(chat(b.page).getByRole("button", { name: /^🔥 1\. Tap to add yours/ })).toBeVisible();
  await expect(chat(a.page).getByRole("button", { name: /^🔥 1, including you/ })).toBeVisible({ timeout: 15_000 });

  // Markup is shown as text: nothing executes, no elements are created.
  const xss = `<img src=x onerror="window.__xss=1"><script>window.__xss=1</script> <b>bold</b>`;
  await send(b.page, xss);
  await expect(chat(b.page).getByText(xss)).toBeVisible();
  await expect(chat(a.page).getByText(xss)).toBeVisible({ timeout: 15_000 });
  for (const p of [a.page, b.page]) {
    expect(await p.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
    await expect(chat(p).locator("img[src='x'], script, b")).toHaveCount(0);
  }

  // Links: only http(s), opened safely.
  await send(a.page, "Route: https://example.com/route?id=7 and javascript:alert(1)");
  const link = chat(b.page).getByRole("link", { name: "https://example.com/route?id=7" });
  await expect(link).toBeVisible({ timeout: 15_000 });
  await expect(link).toHaveAttribute("href", "https://example.com/route?id=7");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(chat(b.page).getByRole("link")).toHaveCount(1);

  // A deletes their own message (menu -> confirm); B sees "Message deleted".
  await chat(a.page).getByTestId("chat-bubble").filter({ hasText: "Route:" }).click({ button: "right" });
  await a.page.getByRole("dialog", { name: "Message actions" }).getByRole("menuitem", { name: "Delete" }).click();
  await a.page.getByRole("button", { name: "Delete for everyone" }).click();
  await expect(chat(a.page).getByText("Message deleted")).toBeVisible();
  await expect(chat(b.page).getByText("Message deleted")).toBeVisible({ timeout: 15_000 });
  await expect(chat(b.page).getByText(/^Route:/)).toHaveCount(0);

  // Unread badge: B moves to Info, A posts, B's Chat tab shows 1 unread.
  await b.page.getByRole("tab", { name: "Info" }).click();
  await send(a.page, "Anyone?");
  await expect(b.page.getByRole("tab", { name: /^Chat \(1 unread\)$/ })).toBeVisible({ timeout: 15_000 });
  await b.page.getByRole("tab", { name: /^Chat/ }).click();
  await expect(b.page.getByRole("tab", { name: /unread/ })).toHaveCount(0);

  // Outsiders can't open the stream (or the history).
  expect((await outsider.page.request.get(`/api/groups/${groupId}/stream`)).status()).toBe(404);
  expect((await outsider.page.request.get(`/api/groups/${groupId}/messages`)).status()).toBe(404);

  await Promise.all([a.ctx.close(), b.ctx.close(), outsider.ctx.close()]);
});
