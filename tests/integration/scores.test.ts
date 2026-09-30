import { and, asc, between, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { dailyMetrics, dailyScores, groupMembers, groups, ingestEvents, users } from "@/db/schema";
import { createKeyForUser } from "@/lib/apikey";
import { ingestDeps } from "@/lib/ingest/handler";
import { createLogger } from "@/lib/log";
import { resetIngestLimiters } from "@/lib/ratelimit";
import type { ScoreComponents } from "@/lib/scores/compute";
import { getDataSpan, getGroupBoard, getOverview, getRecentNights, getTrend, weekStart } from "@/lib/scores/queries";
import { FORWARD_DAYS, ingestRecomputeRange, recomputeAfterIngest, recomputeUser } from "@/lib/scores/recompute";
import { SCORE_VERSION } from "@/lib/scores/types";
import { addDays, todayIn } from "@/lib/tz";
import { buildPayload, chunkRanges, DEMO_USERS, type ProfileId } from "../../scripts/seed/generate";

const route = await import("@/app/api/ingest/route");

const original = { ...ingestDeps };
beforeEach(() => {
  resetIngestLimiters();
  ingestDeps.log = createLogger({ write: () => {} }, { level: "silent" }).child({ module: "ingest" });
});
afterEach(() => {
  Object.assign(ingestDeps, original);
});

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

const demo = (profile: ProfileId) => DEMO_USERS.find((u) => u.profile === profile)!;

async function makeUser(profile: ProfileId, email = `${profile}@example.com`) {
  const u = demo(profile);
  const [row] = await db
    .insert(users)
    .values({
      email,
      username: email.split("@")[0],
      displayName: `${profile} person`,
      timezone: u.timezone,
      onboardedAt: new Date(),
      dob: u.dob,
      maxHr: u.maxHr,
      sleepGoalMin: u.sleepGoalMin,
    })
    .returning();
  const { key } = await createKeyForUser(db, row.id);
  return { user: row, key, demo: u };
}

async function post(key: string, body: unknown) {
  const res = await route.POST(
    new Request("http://localhost/api/ingest", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    }),
  );
  expect(res.status).toBe(200);
  return res.json();
}

/** Backfill `days` days ending today, like the seed (30-day chunks, oldest first). */
async function backfill(key: string, profile: ProfileId, days: number, chunk = 30) {
  const u = demo(profile);
  const now = new Date();
  const today = todayIn(u.timezone, now);
  for (const range of chunkRanges(today, days, chunk)) await post(key, buildPayload(u, { ...range, now }));
  return today;
}

const scoresOf = (userId: string) =>
  db.select().from(dailyScores).where(eq(dailyScores.userId, userId)).orderBy(asc(dailyScores.localDate));

/** Rows without computed_at, for equality checks. */
const comparable = (rows: (typeof dailyScores.$inferSelect)[]) =>
  rows.map((r) => ({ d: r.localDate, s: r.sleepScore, r: r.recovery, t: r.strain, c: r.components }));

/* ------------------------------------------------------------------ */
/* Ingest -> scores                                                      */
/* ------------------------------------------------------------------ */

describe("ingest hook", () => {
  it("scores appear for every ingested date, with the version in components", async () => {
    const { user, key } = await makeUser("watch");
    const today = await backfill(key, "watch", 40);
    const rows = await scoresOf(user.id);
    expect(rows.map((r) => r.localDate)).toEqual(Array.from({ length: 40 }, (_, i) => addDays(today, i - 39)));
    const last = rows.at(-2)!; // yesterday: a complete day
    expect(last.strain).not.toBeNull();
    expect(last.recovery).not.toBeNull();
    expect(last.sleepScore).not.toBeNull();
    const c = last.components as ScoreComponents;
    expect(c.v).toBe(SCORE_VERSION);
    expect(c.recovery.contributors.map((x) => x.key)).toContain("hrv");
    // The first days are calibrating.
    expect((rows[0].components as ScoreComponents).recovery.reason).toBe("calibrating");
  });

  it("a late sync of an old day recomputes that day and the forward window", async () => {
    const { user, key, demo: u } = await makeUser("fitbit");
    const today = await backfill(key, "fitbit", 60);
    const before = await scoresOf(user.id);
    const changed = addDays(today, -50);
    // Resend that day with a much higher resting HR.
    await post(key, [{ date: changed, resting_hr: 75 }]);
    const after = await scoresOf(user.id);
    const stamp = new Map(before.map((r) => [r.localDate, r.computedAt.getTime()]));
    const forwardEnd = addDays(changed, FORWARD_DAYS);
    for (const r of after) {
      const recomputed = r.computedAt.getTime() !== stamp.get(r.localDate);
      const inWindow = r.localDate >= changed && r.localDate <= forwardEnd;
      expect([r.localDate, recomputed]).toEqual([r.localDate, inWindow]);
    }
    // The next day's recovery baseline now includes the high RHR.
    const next = after.find((r) => r.localDate === addDays(changed, 1))!;
    const nextBefore = before.find((r) => r.localDate === addDays(changed, 1))!;
    const rhrBase = (row: typeof next) =>
      (row.components as ScoreComponents).recovery.contributors.find((x) => x.key === "rhr")?.baseline;
    expect(rhrBase(next)).not.toEqual(rhrBase(nextBefore));
    expect(u.timezone).toBeTruthy();
  });

  it("the hook's incremental results equal a full recompute (and recompute is idempotent)", async () => {
    const { user, key } = await makeUser("zepp");
    const today = await backfill(key, "zepp", 75, 20);
    // A couple of rolling 3-day syncs, like the Shortcut.
    const u = demo("zepp");
    await post(key, buildPayload(u, { from: addDays(today, -2), to: today, now: new Date() }));
    const incremental = comparable(await scoresOf(user.id));
    expect(incremental).toHaveLength(75);

    const first = addDays(today, -74);
    const n = await recomputeUser(db, user.id, first, addDays(today, 1));
    expect(n).toBe(75);
    const full = comparable(await scoresOf(user.id));
    expect(full).toEqual(incremental);

    await recomputeUser(db, user.id, first, addDays(today, 1));
    expect(comparable(await scoresOf(user.id))).toEqual(full);
  });

  it("iPhone-only users get strain but no sleep score or recovery", async () => {
    const { user, key } = await makeUser("iphone");
    await backfill(key, "iphone", 20);
    const rows = await scoresOf(user.id);
    expect(rows).toHaveLength(20);
    for (const r of rows.slice(0, -1)) {
      expect(r.sleepScore).toBeNull();
      expect(r.recovery).toBeNull();
      expect(r.strain).not.toBeNull();
    }
    const c = rows.at(-2)!.components as ScoreComponents;
    expect(c.sleep.reason).toBe("in_bed_only");
    expect(c.strain.components.basis).toBe("activity");
  });

  it("dates without any input lose their score row", async () => {
    const { user, key } = await makeUser("watch");
    const today = await backfill(key, "watch", 10);
    const empty = addDays(today, -20);
    await db.insert(dailyScores).values({ userId: user.id, localDate: empty, strain: 5, components: {} });
    await recomputeUser(db, user.id, addDays(today, -30), today);
    const rows = await scoresOf(user.id);
    expect(rows.map((r) => r.localDate)).not.toContain(empty);
    expect(rows).toHaveLength(10);
  });

  it("the recompute range is capped at tomorrow", () => {
    const now = new Date("2026-09-29T10:00:00Z");
    expect(ingestRecomputeRange(["2026-09-27", "2026-09-29"], "Europe/Berlin", now)).toEqual({ from: "2026-09-27", to: "2026-09-30" });
    expect(ingestRecomputeRange(["2026-07-01", "2026-06-20"], "Europe/Berlin", now)).toEqual({
      from: "2026-06-20",
      to: addDays("2026-07-01", FORWARD_DAYS),
    });
    expect(ingestRecomputeRange([], "UTC", now)).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Performance                                                           */
/* ------------------------------------------------------------------ */

describe("performance", () => {
  it("a 3-day sync on a 90-day history and a 366-day backfill recompute fast", async () => {
    const { user, key } = await makeUser("watch");
    const today = await backfill(key, "watch", 90);
    const dates = [addDays(today, -2), addDays(today, -1), today];

    // Warm-up (connection, statement caches), then measure.
    await recomputeAfterIngest(db, user.id, dates);
    const t0 = performance.now();
    await recomputeAfterIngest(db, user.id, dates);
    const sync = performance.now() - t0;

    const t1 = performance.now();
    const n = await recomputeUser(db, user.id, addDays(today, -89), addDays(today, 1));
    const full90 = performance.now() - t1;
    expect(n).toBe(90);

    // A year of history (sent in 90-day chunks: a watch night has ~40 segments), recomputed in one go.
    const big = await makeUser("watch", "big@example.com");
    await backfill(big.key, "watch", 366, 90);
    const t2 = performance.now();
    const n366 = await recomputeUser(db, big.user.id, addDays(today, -365), addDays(today, 1));
    const full366 = performance.now() - t2;
    expect(n366).toBe(366);

    console.info(`scores perf: 3-day sync ${sync.toFixed(0)} ms, 90-day ${full90.toFixed(0)} ms, 366-day ${full366.toFixed(0)} ms`);
    // Real budgets with PERF_STRICT=1 on an idle machine; 5x headroom otherwise (parallel test runs).
    const slack = process.env.PERF_STRICT === "1" ? 1 : 5;
    expect(sync).toBeLessThan(150 * slack);
    expect(full90).toBeLessThan(1000 * slack);
    expect(full366).toBeLessThan(2000 * slack);
  }, 60_000);
});

/* ------------------------------------------------------------------ */
/* Queries                                                               */
/* ------------------------------------------------------------------ */

describe("getOverview / getTrend", () => {
  it("returns the day's scores, key stats with baselines, hourly HR, last night and last sync", async () => {
    const { user, key } = await makeUser("watch");
    const today = await backfill(key, "watch", 45);
    const date = addDays(today, -1);
    const o = await getOverview(db, user.id, date);
    expect(o.scores?.date).toBe(date);
    expect(o.previous?.date).toBe(addDays(date, -1));
    expect(o.stats.map((s) => s.key)).toEqual(["resting_hr", "hrv_sdnn_ms", "resp_rate", "sleep_duration", "steps", "active_kcal"]);
    const rhr = o.stats[0];
    expect(rhr.baseline).not.toBeNull();
    expect(rhr.n).toBeGreaterThanOrEqual(25);
    expect(rhr.delta).toBeCloseTo(rhr.value! - rhr.baseline!, 1);
    expect(rhr.higherIsBetter).toBe(false);
    expect(o.hrHourly.length).toBeGreaterThan(20);
    expect(o.sleep?.night.wakeDate).toBe(date);
    expect(o.sleep!.segments.length).toBeGreaterThan(3);
    expect(o.sleep!.segments.every((s) => s.source === o.sleep!.night.chosenSource || s.stage === "in_bed")).toBe(true);
    const [ev] = await db.select().from(ingestEvents).where(eq(ingestEvents.userId, user.id)).orderBy(asc(ingestEvents.receivedAt)).limit(1);
    expect(o.lastSyncAt!.getTime()).toBeGreaterThanOrEqual(ev.receivedAt.getTime());
  });

  it("an empty day has no scores and no sleep", async () => {
    const { user } = await makeUser("watch");
    const o = await getOverview(db, user.id, "2026-01-10");
    expect(o).toMatchObject({ scores: null, previous: null, sleep: null, lastSyncAt: null, hrHourly: [] });
    expect(o.stats.every((s) => s.value === null && s.baseline === null)).toBe(true);
  });

  it("trends have one point per day, oldest first", async () => {
    const { user, key } = await makeUser("watch");
    const today = await backfill(key, "watch", 35);
    const w = await getTrend(db, user.id, "recovery", "1w", today);
    expect(w).toHaveLength(7);
    expect(w[0].date).toBe(addDays(today, -6));
    expect(w.at(-1)!.date).toBe(today);
    const m = await getTrend(db, user.id, "resting_hr", "1m", today);
    expect(m).toHaveLength(30);
    expect(m.filter((p) => p.value !== null).length).toBeGreaterThan(25);
    const s = await getTrend(db, user.id, "sleep_duration", "6m");
    expect(s).toHaveLength(182);
    expect(s.filter((p) => p.value !== null).length).toBeGreaterThan(25);
    const strain = await getTrend(db, user.id, "strain", "1m", today);
    const [stored] = await db
      .select()
      .from(dailyScores)
      .where(and(eq(dailyScores.userId, user.id), eq(dailyScores.localDate, addDays(today, -3))));
    expect(strain.find((p) => p.date === addDays(today, -3))!.value).toBe(stored.strain);
  });
});

describe("dashboard helpers", () => {
  it("getDataSpan: nothing for a new user", async () => {
    const { user } = await makeUser("watch");
    expect(await getDataSpan(db, user.id)).toEqual({
      firstDate: null,
      lastDate: null,
      hasHrv: false,
      hasResp: false,
      hasRhr: false,
      lastSyncAt: null,
    });
  });

  it("getDataSpan: first/last data date across tables and which vitals the device ever sent", async () => {
    const watch = await makeUser("watch");
    const today = await backfill(watch.key, "watch", 12);
    const w = await getDataSpan(db, watch.user.id);
    expect(w.firstDate).toBe(addDays(today, -11));
    expect(w.lastDate).toBe(today);
    expect(w).toMatchObject({ hasHrv: true, hasResp: true, hasRhr: true });
    expect(w.lastSyncAt).toBeInstanceOf(Date);

    const phone = await makeUser("iphone", "phone@example.com");
    await backfill(phone.key, "iphone", 5);
    expect(await getDataSpan(db, phone.user.id)).toMatchObject({ hasHrv: false, hasResp: false, hasRhr: false });

    const fitbit = await makeUser("fitbit", "fitbit@example.com");
    await backfill(fitbit.key, "fitbit", 5);
    expect(await getDataSpan(db, fitbit.user.id)).toMatchObject({ hasHrv: false, hasResp: true, hasRhr: true });
  });

  it("getDataSpan: a night alone (no metrics) still counts as data", async () => {
    const { user, key } = await makeUser("watch");
    await post(key, {
      tz: "Europe/Berlin",
      days: [],
      sleep_segments: [{ stage: "Core", start: "2026-03-01T23:00:00+01:00", end: "2026-03-02T06:30:00+01:00", source: "Apple Watch" }],
    });
    const s = await getDataSpan(db, user.id);
    expect(s.firstDate).toBe("2026-03-02");
    expect(s.lastDate).toBe("2026-03-02");
    expect(s.hasRhr).toBe(false);
  });

  it("getRecentNights: the 7 nights ending on the date, oldest first", async () => {
    const { user, key } = await makeUser("watch");
    const today = await backfill(key, "watch", 20);
    const date = addDays(today, -2);
    const nights = await getRecentNights(db, user.id, date, 7);
    expect(nights.length).toBeGreaterThanOrEqual(5);
    expect(nights.every((n) => n.wakeDate >= addDays(date, -6) && n.wakeDate <= date)).toBe(true);
    expect(nights.map((n) => n.wakeDate)).toEqual([...nights.map((n) => n.wakeDate)].sort());
    expect(nights[0].bedStart.getTime()).toBeLessThan(nights[0].bedEnd.getTime());
  });

  it("getOverview.activity carries the day's totals (partial today)", async () => {
    const { user, key } = await makeUser("watch");
    const today = await backfill(key, "watch", 10);
    const past = await getOverview(db, user.id, addDays(today, -1));
    expect(past.activity.steps).toBeGreaterThan(1000);
    expect(past.activity.activeKcal).toBeGreaterThan(0);
    expect(past.activity.exerciseMin).not.toBeNull();
    const empty = await getOverview(db, user.id, addDays(today, -40));
    expect(empty.activity).toEqual({ steps: null, activeKcal: null, exerciseMin: null });
  });
});

describe("getGroupBoard", () => {
  const MON = "2026-09-21"; // a Monday

  async function member(name: string, groupId: string, extra: Partial<typeof users.$inferInsert> = {}) {
    const [u] = await db
      .insert(users)
      .values({ email: `${name}@example.com`, username: name, displayName: name, timezone: "UTC", ...extra })
      .returning();
    await db.insert(groupMembers).values({ groupId, userId: u.id });
    return u.id;
  }
  const score = (userId: string, localDate: string, v: { recovery?: number | null; strain?: number | null; sleepScore?: number | null }) =>
    db.insert(dailyScores).values({ userId, localDate, components: {}, ...v });

  it("weekStart is the ISO Monday", () => {
    expect(weekStart("2026-09-21")).toBe("2026-09-21");
    expect(weekStart("2026-09-27")).toBe("2026-09-21"); // Sunday
    expect(weekStart("2026-09-23")).toBe("2026-09-21");
    expect(weekStart("2026-09-28")).toBe("2026-09-28");
  });

  it("day: ranks by value, ties share a rank, members without data are left out", async () => {
    const [g] = await db.insert(groups).values({ name: "Crew" }).returning();
    const a = await member("ann", g.id);
    const b = await member("bob", g.id);
    const c = await member("cat", g.id);
    const d = await member("dan", g.id);
    const e = await member("eve", g.id, { deactivatedAt: new Date() });
    const outsider = (await db.insert(users).values({ email: "x@example.com", username: "x" }).returning())[0].id;
    await score(a, MON, { recovery: 70, strain: 12.3 });
    await score(b, MON, { recovery: 85, strain: 9.1 });
    await score(c, MON, { recovery: 70, strain: 15 });
    await score(d, MON, { recovery: null, strain: 4 }); // no recovery that day
    await score(e, MON, { recovery: 99 }); // deactivated
    await score(outsider, MON, { recovery: 99 }); // not in the group

    const board = await getGroupBoard(db, g.id, "recovery", "day", MON);
    expect(board).toMatchObject({ from: MON, to: MON });
    expect(board.rows.map((r) => [r.username, r.value, r.rank])).toEqual([
      ["bob", 85, 1],
      ["ann", 70, 2],
      ["cat", 70, 2],
    ]);
    const strain = await getGroupBoard(db, g.id, "strain", "day", MON);
    expect(strain.rows.map((r) => [r.username, r.rank])).toEqual([
      ["cat", 1],
      ["ann", 2],
      ["bob", 3],
      ["dan", 4],
    ]);
    const nobody = await getGroupBoard(db, g.id, "sleep", "day", MON);
    expect(nobody.rows).toEqual([]);
  });

  it("week: mean over Mon-Sun, only members with >= 4 days", async () => {
    const [g] = await db.insert(groups).values({ name: "Crew" }).returning();
    const a = await member("ann", g.id);
    const b = await member("bob", g.id);
    const c = await member("cat", g.id);
    // ann: 4 days (Mon-Thu) -> mean 80
    for (const [i, v] of [70, 80, 90, 80].entries()) await score(a, addDays(MON, i), { sleepScore: v });
    // bob: 3 days in the week (+ days outside it) -> excluded
    for (const i of [0, 2, 6]) await score(b, addDays(MON, i), { sleepScore: 95 });
    await score(b, addDays(MON, -1), { sleepScore: 95 });
    await score(b, addDays(MON, 7), { sleepScore: 95 });
    // cat: 7 days, one null -> 6 days, mean 80 -> ties ann
    for (let i = 0; i < 7; i++) await score(c, addDays(MON, i), { sleepScore: i === 3 ? null : 80 });

    const board = await getGroupBoard(db, g.id, "sleep", "week", addDays(MON, 4));
    expect(board).toMatchObject({ from: MON, to: addDays(MON, 6) });
    expect(board.rows.map((r) => [r.username, r.value, r.days, r.rank])).toEqual([
      ["ann", 80, 4, 1],
      ["cat", 80, 6, 1],
    ]);
  });
});

describe("dev DB sanity helpers", () => {
  it("scores are only written for the user whose data changed", async () => {
    const a = await makeUser("watch", "a@example.com");
    const b = await makeUser("fitbit", "b@example.com");
    await backfill(a.key, "watch", 10);
    expect(await scoresOf(b.user.id)).toEqual([]);
    const metricDays = await db
      .select()
      .from(dailyMetrics)
      .where(and(eq(dailyMetrics.userId, a.user.id), between(dailyMetrics.localDate, "2000-01-01", "2100-01-01")));
    expect((await scoresOf(a.user.id)).length).toBe(metricDays.length);
  });
});
