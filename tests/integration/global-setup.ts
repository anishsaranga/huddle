import { migrateTestDatabase } from "../support/test-db";

export default async function setup() {
  await migrateTestDatabase();
}
