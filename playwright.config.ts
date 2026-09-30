import { defineConfig, devices } from "@playwright/test";
import { E2E_ADMIN_EMAIL } from "./tests/support/e2e";
import { assertTestDatabase, TEST_DATABASE_URL } from "./tests/support/test-db";

/**
 * E2E runs against its own `next dev` (default :3200, override with E2E_PORT) with a separate distDir per
 * port (`.next-e2e-<port>`, so it can run alongside the regular dev server on :3000 and alongside other
 * worktrees on other ports), the test-only login bypass enabled and the test database
 * (TEST_DATABASE_URL, default huddle_test). See docs/dev.md, "Running tests in parallel".
 */
const PORT = Number(process.env.E2E_PORT || 3200);
if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535) {
  throw new Error(`E2E_PORT must be a port number between 1024 and 65535, got "${process.env.E2E_PORT}".`);
}
assertTestDatabase(TEST_DATABASE_URL);
const DIST_DIR = `.next-e2e-${PORT}`;

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  // `next dev` compiles each route on first hit, which can take several seconds on a cold or busy machine,
  // so waits that depend on a navigation need more than the 5 s default.
  expect: { timeout: 15_000 },
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      E2E_AUTH: "1",
      NEXT_DIST_DIR: DIST_DIR,
      DATABASE_URL: TEST_DATABASE_URL,
      // Uploaded avatar photos land in the (gitignored) e2e dist dir, not ./data.
      AVATAR_DIR: `${DIST_DIR}/avatars`,
      // The account that is admin on this server (whatever .env says).
      ADMIN_EMAIL: E2E_ADMIN_EMAIL,
      // Deterministic "Google not configured" behavior regardless of .env.
      AUTH_GOOGLE_ID: "",
      AUTH_GOOGLE_SECRET: "",
      LOG_LEVEL: "warn",
    },
  },
  use: {
    baseURL: process.env.E2E_BASE_URL || `http://localhost:${PORT}`,
    navigationTimeout: 30_000,
    actionTimeout: 15_000,
  },
  projects: [
    {
      name: "Mobile Chrome",
      use: {
        ...devices["iPhone 15"],
        browserName: "chromium",
      },
    },
  ],
});
