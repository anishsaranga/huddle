import { afterAll, beforeEach } from "vitest";
import { assertTestDatabase, TEST_DATABASE_URL } from "../support/test-db";

// Must run before anything imports @/db or @/lib/env.
assertTestDatabase(TEST_DATABASE_URL);
process.env.DATABASE_URL = TEST_DATABASE_URL;

const { sql, closeDb } = await import("@/db");

beforeEach(async () => {
  const rows = await sql<{ tablename: string }[]>`
    select tablename from pg_tables where schemaname = 'public'`;
  if (rows.length === 0) return;
  const tables = rows.map((r) => `"public"."${r.tablename}"`).join(", ");
  await sql.unsafe(`truncate ${tables} restart identity cascade`);
});

afterAll(async () => {
  await closeDb();
});
