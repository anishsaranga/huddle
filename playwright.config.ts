import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  webServer: {
    command: "npm run dev",
    port: 3000,
    reuseExistingServer: true,
  },
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://localhost:3000",
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
