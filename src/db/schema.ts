import { pgTable, text } from "drizzle-orm/pg-core";

/** Placeholder table; real schema arrives in later tasks. */
export const appMeta = pgTable("app_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
