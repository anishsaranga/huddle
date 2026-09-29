/**
 * `npm run db:seed`: fill the DEV database with six demo friends and 90 days
 * of realistic health data, pushed through the real ingest pipeline
 * (handleIngest with constructed Requests), so the admin Data views, scores
 * and charts have something to show. Refuses to run in production or against
 * any database not named `huddle` or `*_test`. Safe to rerun: demo users are
 * matched by email and their previous data is replaced.
 */

import { seededRng } from "../src/lib/avatar/config";
import {
  buildPayload,
  chunkRanges,
  DEMO_USERS,
  PROFILE_LABELS,
  wallToMs,
  type DemoUser,
} from "./seed/generate";
import { checkSeedTarget } from "./seed/guard";

try {
  process.loadEnvFile(".env");
} catch {
  // fall back to the real environment
}

const TOTAL_DAYS = 90;
const CHUNK_DAYS = 30;
/** Rolling-window "daily syncs" simulated for the last few days. */
const DAILY_SYNC_DAYS = 6;

function fail(message: string): never {
  console.error(`seed-dev: ${message}`);
  process.exit(1);
}

async function main() {
  const target = checkSeedTarget(process.env);
  if (!target.ok) fail(target.error);
  const { display } = target;
  // Keep pino quiet (the ingest handler and key helpers log per call).
  process.env.LOG_LEVEL = "fatal";
  console.log(`Seeding database: ${display}\n`);

  // Imported only after the guard passes, so nothing touches the DB before it.
  const { count, eq, inArray } = await import("drizzle-orm");
  const { db, closeDb } = await import("../src/db");
  const schema = await import("../src/db/schema");
  const { randomConfig } = await import("../src/lib/avatar/config");
  const { createKeyForUser } = await import("../src/lib/apikey");
  const { handleIngest, ingestDeps } = await import("../src/lib/ingest/handler");
  const { SlidingWindowLimiter } = await import("../src/lib/ratelimit");
  const { createLogger } = await import("../src/lib/log");
  const { addDays, localDateOf } = await import("../src/lib/tz");
  const { getEnv } = await import("../src/lib/env");

  const { users, allowedEmails, groups, groupMembers } = schema;

  // The ingest handler logs one line per request: keep the seed output readable.
  ingestDeps.log = createLogger({ write: () => {} }, { level: "silent" }).child({ module: "ingest" });
  const big = () => new SlidingWindowLimiter({ limit: 100_000, windowMs: 3_600_000 });
  ingestDeps.limiters = { ip: big(), key: big() };
  const realNow = ingestDeps.now;

  /* ------------------------------ users ------------------------------ */

  const now = new Date();
  const ids = new Map<string, string>();
  for (const u of DEMO_USERS) {
    const avatarConfig = randomConfig(undefined, seededRng(u.email));
    const profile = {
      name: u.displayName,
      displayName: u.displayName,
      username: u.username,
      avatarKind: "dicebear" as const,
      avatarConfig,
      timezone: u.timezone,
      units: u.units,
      dob: u.dob,
      sex: u.sex,
      heightCm: u.heightCm,
      weightKg: u.weightKg,
      maxHr: u.maxHr,
      stepGoal: u.stepGoal,
      sleepGoalMin: u.sleepGoalMin,
    };
    const [row] = await db
      .insert(users)
      .values({ email: u.email, emailVerified: now, onboardedAt: now, ...profile })
      .onConflictDoUpdate({ target: users.email, set: { ...profile, deactivatedAt: null } })
      .returning({ id: users.id });
    ids.set(u.slug, row.id);
    await db.insert(allowedEmails).values({ email: u.email }).onConflictDoNothing();
  }
  const userIds = [...ids.values()];

  /* ------------------------------ group ------------------------------ */

  let [group] = await db.select().from(groups).where(eq(groups.name, "Morning Crew")).limit(1);
  if (!group) [group] = await db.insert(groups).values({ name: "Morning Crew", timezone: "Europe/Berlin" }).returning();
  const memberIds = [...userIds];
  const adminEmail = getEnv().ADMIN_EMAIL?.toLowerCase();
  const admin = adminEmail ? (await db.select({ id: users.id }).from(users).where(eq(users.email, adminEmail)).limit(1))[0] : undefined;
  if (admin) memberIds.push(admin.id);
  await db
    .insert(groupMembers)
    .values(memberIds.map((userId) => ({ groupId: group.id, userId })))
    .onConflictDoNothing();

  /* ------------------------ clean slate + keys ------------------------ */

  // Replace, don't accumulate: the window slides a day per run.
  for (const table of [
    schema.dailyMetrics,
    schema.hrHourly,
    schema.sleepSegments,
    schema.sleepNights,
    schema.dailyScores,
    schema.ingestEvents,
  ]) {
    await db.delete(table).where(inArray(table.userId, userIds));
  }
  const keys = new Map<string, { key: string; prefix: string }>();
  for (const u of DEMO_USERS) {
    const created = await createKeyForUser(db, ids.get(u.slug)!);
    keys.set(u.slug, { key: created.key, prefix: created.prefixHint });
  }

  /* ----------------------------- ingesting ----------------------------- */

  const results: Record<string, number> = {};
  let requestNo = 0;
  async function send(u: DemoUser, body: unknown, opts: { at?: Date; query?: boolean; raw?: string } = {}): Promise<number> {
    const { key } = keys.get(u.slug)!;
    const headers: Record<string, string> = {
      "content-type": "application/json",
      // One client IP per person, like real devices.
      "x-forwarded-for": `203.0.113.${DEMO_USERS.indexOf(u) + 10}`,
    };
    if (!opts.query) headers.authorization = `Bearer ${key}`;
    const request = new Request(`http://localhost/api/ingest${opts.query ? `?key=${key}` : ""}`, {
      method: "POST",
      headers,
      body: opts.raw ?? JSON.stringify(body),
    });
    ingestDeps.now = opts.at ? () => opts.at! : realNow;
    try {
      const res = await handleIngest(request);
      await res.arrayBuffer();
      requestNo++;
      results[`${res.status}`] = (results[`${res.status}`] ?? 0) + 1;
      return res.status;
    } finally {
      ingestDeps.now = realNow;
    }
  }

  const localTime = (u: DemoUser, date: string, h: number, m: number) => new Date(wallToMs(date, h * 60 + m, u.timezone));

  for (const u of DEMO_USERS) {
    const today = localDateOf(now.getTime(), u.timezone);
    const rng = seededRng(`${u.email}|syncs`);

    // 1. Backfill: 90 days in 30-day chunks, oldest first.
    for (const range of chunkRanges(today, TOTAL_DAYS, CHUNK_DAYS)) {
      const status = await send(u, buildPayload(u, { ...range, now }));
      if (status !== 200) fail(`backfill for ${u.slug} ${range.from}..${range.to} failed with ${status}`);
    }

    // 2. The last days' morning syncs: a rolling 3-day window, stamped at the time they'd have arrived.
    for (let k = DAILY_SYNC_DAYS; k >= 1; k--) {
      if (u.profile === "zepp" && rng() < 0.35) continue; // Zepp only syncs after its own app does
      const date = addDays(today, -k);
      const at = localTime(u, date, 8, 5 + Math.floor(rng() * 50));
      const body = buildPayload(u, { from: addDays(date, -2), to: date, now: at });
      const status = await send(u, body, { at, query: u.slug === "arjun" });
      if (status !== 200) fail(`daily sync for ${u.slug} on ${date} failed with ${status}`);
    }

    // 3. A fresh sync right now.
    const status = await send(u, buildPayload(u, { from: addDays(today, -2), to: today, now }));
    if (status !== 200) fail(`latest sync for ${u.slug} failed with ${status}`);
  }

  // A few failures, so the ingest log has something other than 200s to show.
  const byslug = (slug: string) => DEMO_USERS.find((u) => u.slug === slug)!;
  {
    const u = byslug("jamal");
    const today = localDateOf(now.getTime(), u.timezone);
    await send(u, { date: today, steps: "lots", resting_hr: 999, hrv_sdnn_ms: "n/a" }, { at: localTime(u, addDays(today, -2), 21, 14) });
  }
  {
    const u = byslug("sofia");
    const today = localDateOf(now.getTime(), u.timezone);
    await send(u, null, { at: localTime(u, addDays(today, -1), 8, 41), raw: '{"days": [{"date": "2026-' });
  }
  {
    // Rate limited: a key limiter that allows one request, then a second one.
    const u = byslug("priya");
    const today = localDateOf(now.getTime(), u.timezone);
    ingestDeps.limiters = { ip: big(), key: new SlidingWindowLimiter({ limit: 1, windowMs: 3_600_000 }) };
    const at = localTime(u, addDays(today, -1), 19, 30);
    await send(u, buildPayload(u, { from: addDays(today, -1), to: addDays(today, -1), now: at }), { at });
    await send(u, buildPayload(u, { from: addDays(today, -1), to: addDays(today, -1), now: at }), { at: new Date(at.getTime() + 60_000) });
    ingestDeps.limiters = { ip: big(), key: big() };
  }

  /* ------------------------------ scores ------------------------------ */

  // The ingest hook already recomputed scores after every request; one full
  // pass per user makes the result independent of the order things arrived in.
  const { recomputeUser } = await import("../src/lib/scores/recompute");
  const scoreRows = new Map<string, number>();
  for (const u of DEMO_USERS) {
    const today = localDateOf(now.getTime(), u.timezone);
    const from = addDays(today, -(TOTAL_DAYS - 1));
    scoreRows.set(u.slug, await recomputeUser(db, ids.get(u.slug)!, from, addDays(today, 1)));
  }

  /* ------------------------------ summary ------------------------------ */

  const rows: string[][] = [["user", "profile", "format", "tz", "days", "scores", "requests", "key"]];
  for (const u of DEMO_USERS) {
    const id = ids.get(u.slug)!;
    const [{ days }] = await db.select({ days: count() }).from(schema.dailyMetrics).where(eq(schema.dailyMetrics.userId, id));
    const [{ events }] = await db.select({ events: count() }).from(schema.ingestEvents).where(eq(schema.ingestEvents.userId, id));
    rows.push([u.displayName, PROFILE_LABELS[u.profile], u.format, u.timezone, String(days), String(scoreRows.get(u.slug) ?? 0), String(events), `${keys.get(u.slug)!.prefix}…`]);
  }
  const widths = rows[0].map((_, c) => Math.max(...rows.map((r) => r[c].length)));
  for (const [i, r] of rows.entries()) {
    console.log(r.map((cell, c) => cell.padEnd(widths[c])).join("  "));
    if (i === 0) console.log(widths.map((w) => "-".repeat(w)).join("  "));
  }
  console.log(`\nIngest requests: ${requestNo} (${Object.entries(results).map(([s, n]) => `${s}: ${n}`).join(", ")})`);
  console.log(`Group "Morning Crew": ${memberIds.length} members${admin ? " (including the admin)" : ""}`);
  console.log("Demo API keys were rotated; the plaintext isn't kept anywhere.");

  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
