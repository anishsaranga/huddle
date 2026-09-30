import { afterAll, beforeEach } from "vitest";
import { assertTestDatabase, TEST_DATABASE_URL, truncateAllTables } from "../support/test-db";

// Must run before anything imports @/db or @/lib/env.
assertTestDatabase(TEST_DATABASE_URL);
process.env.DATABASE_URL = TEST_DATABASE_URL;
// API keys are HMACed with this pepper; tests don't read .env.
process.env.API_KEY_PEPPER ||= "integration-test-pepper";

const { sql, closeDb } = await import("@/db");

beforeEach(async () => {
  await truncateAllTables(sql);
});

afterAll(async () => {
  await closeDb();
});
