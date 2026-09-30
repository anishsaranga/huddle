/**
 * Create (if missing) and migrate a per-slot test database, so parallel worktrees don't share one.
 *   npm run db:test:create -- <slot>     ->  database huddle_test_<slot>
 */
import postgres from "postgres";
import { assertValidSlot, migrateTestDatabase, slotDatabaseName } from "../tests/support/test-db";

const BASE = process.env.TEST_DB_SERVER_URL || "postgres://huddle:huddle@localhost:5433";

async function main() {
  const slot = process.argv[2];
  if (!slot) {
    console.error("Usage: npm run db:test:create -- <slot>   (slot: [a-z0-9_]{1,20})");
    process.exit(1);
  }
  assertValidSlot(slot);
  const name = slotDatabaseName(slot);

  const admin = postgres(`${BASE}/huddle`, { max: 1, onnotice: () => {} });
  try {
    const found = await admin`select 1 from pg_database where datname = ${name}`;
    if (found.length === 0) {
      // Identifiers can't be bound; `name` is validated above.
      await admin.unsafe(`create database "${name}"`);
      console.log(`Created database ${name}.`);
    } else {
      console.log(`Database ${name} already exists.`);
    }
  } finally {
    await admin.end();
  }

  const url = `${BASE}/${name}`;
  await migrateTestDatabase(url);
  console.log("Migrations applied.");
  console.log(`\nTEST_DATABASE_URL=${url}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
