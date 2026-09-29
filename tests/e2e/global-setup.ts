import { migrateTestDatabase } from "../support/test-db";

export default async function globalSetup() {
  await migrateTestDatabase();
}
