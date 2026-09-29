import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { requireEnv } from "@/lib/env";
import * as schema from "./schema";

type Db = PostgresJsDatabase<typeof schema>;

const globalForDb = globalThis as unknown as {
  __huddleSql?: postgres.Sql;
  __huddleDb?: Db;
};

function init() {
  if (!globalForDb.__huddleSql) {
    globalForDb.__huddleSql = postgres(requireEnv("DATABASE_URL"), { max: 10 });
    globalForDb.__huddleDb = drizzle(globalForDb.__huddleSql, { schema });
  }
  return { sql: globalForDb.__huddleSql, db: globalForDb.__huddleDb as Db };
}

/**
 * Lazy proxies: the connection is created on first use, so importing this
 * module (e.g. during `next build`) never requires DATABASE_URL. The instance
 * is cached on globalThis so dev HMR doesn't leak connections.
 */
export const db: Db = new Proxy({} as Db, {
  get: (_t, prop) => Reflect.get(init().db, prop),
});

/** Raw postgres.js client (tagged-template SQL). */
export const sql: postgres.Sql = new Proxy((() => {}) as unknown as postgres.Sql, {
  get: (_t, prop) => Reflect.get(init().sql, prop),
  apply: (_t, _this, args) =>
    (init().sql as unknown as (...a: unknown[]) => unknown)(...args),
});

/**
 * The real (non-proxy) Drizzle instance. Needed where libraries inspect the
 * db's class, e.g. the Auth.js Drizzle adapter's dialect detection.
 */
export function getDb(): Db {
  return init().db;
}

/** Close the pool and forget it (tests, worker shutdown). The next use reconnects. */
export async function closeDb(): Promise<void> {
  const client = globalForDb.__huddleSql;
  globalForDb.__huddleSql = undefined;
  globalForDb.__huddleDb = undefined;
  await client?.end();
}
