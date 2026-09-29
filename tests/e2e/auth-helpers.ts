import { expect, type Page } from "@playwright/test";

/**
 * Sign in through the e2e-only bypass (POST /api/test/login). The response's
 * session cookie lands in the page's browser context.
 */
export async function loginAs(
  page: Page,
  email = "e2e-user@example.com",
  opts: { onboarded?: boolean; name?: string } = {},
) {
  const res = await page.request.post("/api/test/login", {
    data: { email, name: opts.name ?? "E2E User", onboarded: opts.onboarded ?? true },
  });
  expect(res.status(), "test login bypass must be enabled (E2E_AUTH=1)").toBe(200);
  return (await res.json()) as { userId: string };
}
