/**
 * Where the dev scripts (seed, score recompute) may run: never with
 * NODE_ENV=production, and only against a database named `huddle` (the dev
 * DB) or ending in `_test`. Pure, so a unit test can cover it.
 */

export type SeedTarget = { ok: true; display: string; name: string } | { ok: false; error: string };

export function isSeedableDatabase(name: string): boolean {
  return name === "huddle" || name.endsWith("_test");
}

/** The database checks shared by every dev script (`verb` goes into the error, e.g. "seed"). */
export function checkDevDatabase(env: { NODE_ENV?: string; DATABASE_URL?: string }, verb = "use"): SeedTarget {
  if (env.NODE_ENV === "production") return { ok: false, error: "refusing to run with NODE_ENV=production." };
  if (!env.DATABASE_URL) return { ok: false, error: "DATABASE_URL is not set (see .env.example)." };
  let url: URL;
  try {
    url = new URL(env.DATABASE_URL);
  } catch {
    return { ok: false, error: "DATABASE_URL is not a valid URL." };
  }
  const name = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!isSeedableDatabase(name)) {
    return { ok: false, error: `refusing to ${verb} database "${name}": only "huddle" or names ending in _test are allowed.` };
  }
  return { ok: true, name, display: `${url.hostname}:${url.port || "5432"}/${name}` };
}

export function checkSeedTarget(env: { NODE_ENV?: string; DATABASE_URL?: string; API_KEY_PEPPER?: string }): SeedTarget {
  const target = checkDevDatabase(env, "seed");
  if (!target.ok) return target;
  if (!env.API_KEY_PEPPER) return { ok: false, error: "API_KEY_PEPPER is not set (see .env.example)." };
  return target;
}
