import postgres from "postgres";
import { assertTestDatabase, migrateTestDatabase, TEST_DATABASE_URL, truncateAllTables } from "../support/test-db";

/** Migrate, then empty every app table so each e2e run starts clean (tests create their own data). */
export default async function globalSetup() {
  assertTestDatabase(TEST_DATABASE_URL);
  await migrateTestDatabase();
  const client = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    await truncateAllTables(client);
  } finally {
    await client.end();
  }
}
