import type { db as defaultDb } from "@/db";

/** The app's Drizzle instance type (what admin functions take, so tests can pass the real one). */
export type Db = typeof defaultDb;

/** Anything that can run queries: the db itself or a transaction handle. */
export type Executor = Pick<Db, "select" | "insert" | "update" | "delete">;

/** Result of an admin mutation. `code` is stable for tests/UI; `message` is user-facing. */
export type Failure<C extends string> = { ok: false; code: C; message: string };
export type Ok<T = object> = { ok: true } & T;
export type Result<T, C extends string> = Ok<T> | Failure<C>;

export function fail<C extends string>(code: C, message: string): Failure<C> {
  return { ok: false, code, message };
}

/** What server actions return to client components. */
export type ActionResult<T = object> =
  | ({ ok: true; message?: string } & T)
  | { ok: false; error: string };
