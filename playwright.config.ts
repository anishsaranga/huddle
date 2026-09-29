import { defineConfig, devices } from "@playwright/test";
import { E2E_ADMIN_EMAIL } from "./tests/support/e2e";
import { TEST_DATABASE_URL } from "./tests/support/test-db";

/**
 * E2E runs against its own `next dev` on :3200 (separate distDir, so it can
 * run alongside the regular dev server on :3000) with the test-only login
 * bypass enabled and the huddle_test database. See docs/dev.md.
 */
const PORT = 3200;

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      E2E_AUTH: "1",
      NEXT_DIST_DIR: ".next-e2e",
      DATABASE_URL: TEST_DATABASE_URL,
      // Uploaded avatar photos land in the (gitignored) e2e dist dir, not ./data.
      AVATAR_DIR: ".next-e2e/avatars",
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
