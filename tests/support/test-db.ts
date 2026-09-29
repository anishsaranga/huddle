import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/** Integration + e2e database. Never the dev DB. */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL || "postgres://huddle:huddle@localhost:5433/huddle_test";

export function assertTestDatabase(url: string): void {
  const name = new URL(url).pathname.replace(/^\//, "");
  if (!name.endsWith("_test")) {
    throw new Error(`Refusing to use database "${name}" for tests: its name must end in _test.`);
  }
}

/** Apply all Drizzle migrations to the test database. */
export async function migrateTestDatabase(url = TEST_DATABASE_URL): Promise<void> {
  assertTestDatabase(url);
  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
  } finally {
    await client.end();
  }
}
