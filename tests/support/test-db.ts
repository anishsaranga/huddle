import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/** Integration + e2e database. Never the dev DB. */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL || "postgres://huddle:huddle@localhost:5433/huddle_test";

/** `huddle_test` or a per-slot copy, `huddle_test_<slot>` (see scripts/test-db.ts). */
const TEST_DB_NAME = /^huddle_test(_[a-z0-9_]{1,20})?$/;
const SLOT = /^[a-z0-9_]{1,20}$/;

export function assertTestDatabase(url: string): void {
  const name = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  if (!TEST_DB_NAME.test(name)) {
    throw new Error(
      `Refusing to use database "${name}" for tests: its name must be huddle_test or huddle_test_<slot>.`,
    );
  }
}

export function assertValidSlot(slot: string): void {
  if (!SLOT.test(slot)) {
    throw new Error(`Invalid slot "${slot}": use 1-20 characters from [a-z0-9_].`);
  }
}

export function slotDatabaseName(slot: string): string {
  assertValidSlot(slot);
  return `huddle_test_${slot}`;
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

/** Truncate every table in the public schema (the drizzle migration journal lives elsewhere and is kept). */
export async function truncateAllTables(client: postgres.Sql): Promise<void> {
  const rows = await client<{ tablename: string }[]>`
    select tablename from pg_tables where schemaname = 'public'`;
  if (rows.length === 0) return;
  const tables = rows.map((r) => `"public"."${r.tablename}"`).join(", ");
  await client.unsafe(`truncate ${tables} restart identity cascade`);
}
