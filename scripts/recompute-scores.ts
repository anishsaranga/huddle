/**
 * `npm run scores:recompute [-- --user <id|email|username>] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--show N]`
 *
 * Recompute `daily_scores` from the raw health tables, for every user with
 * data or one user. Default range per user: their first date with data
 * through tomorrow (their timezone). `--show N` prints each user's last N days
 * of sleep / recovery / strain afterwards. Dev/test databases only (same
 * guard as the seed).
 */

import { checkDevDatabase } from "./seed/guard";

try {
  process.loadEnvFile(".env");
} catch {
  // fall back to the real environment
}

function fail(message: string): never {
  console.error(`scores:recompute: ${message}`);
  process.exit(1);
}

type Args = { user?: string; from?: string; to?: string; show: number };

function parseArgs(argv: string[]): Args {
  const args: Args = { show: 0 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (!v || v.startsWith("--")) fail(`${a} needs a value`);
      return v;
    };
    if (a === "--user") args.user = next();
    else if (a === "--from") args.from = next();
    else if (a === "--to") args.to = next();
    else if (a === "--show") args.show = Number(next());
    else if (a === "--help" || a === "-h") {
      console.log("usage: npm run scores:recompute -- [--user <id|email|username>] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--show N]");
      process.exit(0);
    } else fail(`unknown argument ${a}`);
  }
  for (const d of [args.from, args.to]) if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) fail(`bad date ${d}`);
  if (!Number.isInteger(args.show) || args.show < 0) fail("--show takes a whole number of days");
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const target = checkDevDatabase(process.env, "recompute scores in");
  if (!target.ok) fail(target.error);
  process.env.LOG_LEVEL ||= "warn";
  console.log(`Recomputing scores in: ${target.display}\n`);

  const { and, asc, between, eq, min, or } = await import("drizzle-orm");
  const { db, closeDb } = await import("../src/db");
  const { dailyMetrics, dailyScores, hrHourly, sleepNights, users } = await import("../src/db/schema");
  const { recomputeUser } = await import("../src/lib/scores/recompute");
  const { addDays, todayIn } = await import("../src/lib/tz");

  const where = args.user
    ? /^[0-9a-f-]{36}$/i.test(args.user)
      ? eq(users.id, args.user)
      : or(eq(users.email, args.user.toLowerCase()), eq(users.username, args.user))
    : undefined;
  const list = await db
    .select({ id: users.id, email: users.email, name: users.displayName, username: users.username, tz: users.timezone })
    .from(users)
    .where(where)
    .orderBy(asc(users.email));
  if (args.user && list.length === 0) fail(`no user matches ${args.user}`);

  // First date with any data, per user (three grouped queries).
  const firsts = new Map<string, string>();
  for (const [table, col, uid] of [
    [dailyMetrics, dailyMetrics.localDate, dailyMetrics.userId],
    [sleepNights, sleepNights.wakeDate, sleepNights.userId],
    [hrHourly, hrHourly.localDate, hrHourly.userId],
  ] as const) {
    const rows = await db.select({ userId: uid, first: min(col) }).from(table).groupBy(uid);
    for (const r of rows) {
      if (!r.first) continue;
      const cur = firsts.get(r.userId);
      if (!cur || r.first < cur) firsts.set(r.userId, r.first);
    }
  }

  let total = 0;
  const t0 = performance.now();
  for (const u of list) {
    const first = firsts.get(u.id);
    if (!first && !args.from) continue;
    const tz = u.tz || "UTC";
    const from = args.from ?? first!;
    const to = args.to ?? addDays(todayIn(tz), 1);
    const t = performance.now();
    const rows = await recomputeUser(db, u.id, from, to);
    total += rows;
    console.log(`${(u.name ?? u.username ?? u.email).padEnd(18)} ${from}..${to}  ${String(rows).padStart(4)} rows  ${Math.round(performance.now() - t)} ms`);
  }
  console.log(`\n${total} rows for ${list.length} user(s) in ${Math.round(performance.now() - t0)} ms`);

  if (args.show > 0) {
    for (const u of list) {
      const to = todayIn(u.tz || "UTC");
      const from = addDays(to, -(args.show - 1));
      const rows = await db
        .select()
        .from(dailyScores)
        .where(and(eq(dailyScores.userId, u.id), between(dailyScores.localDate, from, to)))
        .orderBy(asc(dailyScores.localDate));
      if (rows.length === 0) continue;
      console.log(`\n${u.name ?? u.email}`);
      console.log("  date        sleep  recovery        strain  notes");
      for (const r of rows) {
        const c = (r.components ?? {}) as {
          sleep?: { reason?: string };
          recovery?: { band?: string; limited?: boolean; reason?: string; missing?: string[] };
          strain?: { components?: { basis?: string } };
        };
        const rec = r.recovery === null ? "-" : `${r.recovery} ${c.recovery?.band ?? ""}${c.recovery?.limited ? "*" : ""}`;
        const notes = [
          c.sleep?.reason && `sleep:${c.sleep.reason}`,
          c.recovery?.reason && `recovery:${c.recovery.reason}`,
          c.recovery?.limited && r.recovery !== null && `missing:${(c.recovery.missing ?? []).join("/")}`,
          c.strain?.components?.basis && `strain:${c.strain.components.basis}`,
        ]
          .filter(Boolean)
          .join(" ");
        console.log(
          `  ${r.localDate}  ${String(r.sleepScore ?? "-").padStart(5)}  ${rec.padEnd(14)}  ${String(r.strain ?? "-").padStart(6)}  ${notes}`,
        );
      }
    }
  }
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
