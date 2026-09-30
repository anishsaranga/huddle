import { mkdtemp, readdir, rm, utimes, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { dailyMetrics, dailyScores, hrHourly, ingestEvents, sleepNights, sleepSegments, users } from "@/db/schema";
import { runRetention } from "@/lib/retention";
import { addDays, todayIn } from "@/lib/tz";

/** 2026-09-29 10:30 UTC = 03:30 on 09-29 in Los Angeles but 00:30 on 09-30 in Kiritimati (UTC+14). */
const NOW = new Date("2026-09-29T10:30:00Z");
const DAY_MS = 86_400_000;

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "huddle-retention-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});
beforeEach(async () => {
  for (const f of await readdir(dir)) await rm(path.join(dir, f), { recursive: true, force: true });
});

async function makeUser(email: string, timezone: string | null) {
  const [u] = await db.insert(users).values({ email, timezone, onboardedAt: new Date() }).returning();
  return u;
}

/** One row per daily table for each of the local dates. */
async function seedDays(userId: string, dates: string[]) {
  for (const d of dates) {
    await db.insert(dailyMetrics).values({ userId, localDate: d, steps: 1000 });
    await db.insert(hrHourly).values({ userId, localDate: d, hour: 8, avg: 60 });
    await db.insert(dailyScores).values({ userId, localDate: d, recovery: 50 });
    await db.insert(sleepNights).values({
      userId,
      wakeDate: d,
      chosenSource: "Watch",
      bedStart: new Date(`${d}T00:00:00Z`),
      bedEnd: new Date(`${d}T07:00:00Z`),
    });
    await db.insert(sleepSegments).values({
      userId,
      wakeDate: d,
      stage: "core",
      startTs: new Date(`${d}T00:00:00Z`),
      endTs: new Date(`${d}T01:00:00Z`),
    });
  }
}

async function remaining(userId: string) {
  const dates = async (rows: Promise<object[]>, col: string) =>
    (await rows).map((r) => (r as Record<string, string>)[col]).sort();
  const metrics = await dates(db.select().from(dailyMetrics).where(eq(dailyMetrics.userId, userId)), "localDate");
  return {
    metrics,
    hr: await dates(db.select().from(hrHourly).where(eq(hrHourly.userId, userId)), "localDate"),
    scores: await dates(db.select().from(dailyScores).where(eq(dailyScores.userId, userId)), "localDate"),
    nights: await dates(db.select().from(sleepNights).where(eq(sleepNights.userId, userId)), "wakeDate"),
    segments: await dates(db.select().from(sleepSegments).where(eq(sleepSegments.userId, userId)), "wakeDate"),
  };
}

describe("daily data retention (365 days, per user's local today)", () => {
  it("deletes local_date = today-365 and keeps today-364 (exact boundary), in every daily table", async () => {
    const u = await makeUser("utc@example.com", "UTC");
    const today = todayIn("UTC", NOW);
    expect(today).toBe("2026-09-29");
    const keep = addDays(today, -364);
    const gone = addDays(today, -365);
    const older = addDays(today, -400);
    await seedDays(u.id, [older, gone, keep, today]);

    const res = await runRetention(db, NOW, { avatarDir: dir });
    expect(res).toMatchObject({ dailyMetrics: 2, hrHourly: 2, sleepNights: 2, sleepSegments: 2, dailyScores: 2 });

    const left = await remaining(u.id);
    for (const dates of Object.values(left)) expect(dates).toEqual([keep, today]);
  });

  it("uses each user's own timezone: same UTC instant, different cutoffs (Kiritimati vs Los Angeles)", async () => {
    const kiri = await makeUser("kiri@example.com", "Pacific/Kiritimati");
    const la = await makeUser("la@example.com", "America/Los_Angeles");
    const kiriToday = todayIn("Pacific/Kiritimati", NOW);
    const laToday = todayIn("America/Los_Angeles", NOW);
    expect(kiriToday).toBe("2026-09-30");
    expect(laToday).toBe("2026-09-29");

    // The two zones' cutoffs are one day apart, so the middle date is the interesting one.
    const d1 = addDays(laToday, -366); // older than both cutoffs
    const d2 = addDays(laToday, -365); // LA: exactly on the cutoff (deleted); Kiritimati: today-366 (deleted)
    const d3 = addDays(laToday, -364); // LA: kept; Kiritimati: today-365 (deleted)
    const d4 = addDays(laToday, -363); // both keep
    await seedDays(kiri.id, [d1, d2, d3, d4]);
    await seedDays(la.id, [d1, d2, d3, d4]);

    await runRetention(db, NOW, { avatarDir: dir });

    const kiriLeft = await remaining(kiri.id);
    const laLeft = await remaining(la.id);
    for (const dates of Object.values(kiriLeft)) expect(dates).toEqual([d4]);
    for (const dates of Object.values(laLeft)) expect(dates).toEqual([d3, d4]);
  });

  it("falls back to UTC for a missing or invalid timezone", async () => {
    const none = await makeUser("none@example.com", null);
    const bad = await makeUser("bad@example.com", "Not/AZone");
    const today = todayIn("UTC", NOW);
    const days = [addDays(today, -365), addDays(today, -364)];
    await seedDays(none.id, days);
    await seedDays(bad.id, days);

    await runRetention(db, NOW, { avatarDir: dir });

    expect((await remaining(none.id)).metrics).toEqual([days[1]]);
    expect((await remaining(bad.id)).metrics).toEqual([days[1]]);
  });

  it("is idempotent and reports zero on a second run", async () => {
    const u = await makeUser("again@example.com", "UTC");
    await seedDays(u.id, [addDays(todayIn("UTC", NOW), -500)]);
    expect((await runRetention(db, NOW, { avatarDir: dir })).dailyMetrics).toBe(1);
    expect(await runRetention(db, NOW, { avatarDir: dir })).toMatchObject({
      dailyMetrics: 0,
      hrHourly: 0,
      sleepNights: 0,
      sleepSegments: 0,
      dailyScores: 0,
      ingestEvents: 0,
      avatarFiles: 0,
    });
  });

  it("works with no users at all", async () => {
    expect(await runRetention(db, NOW, { avatarDir: dir })).toMatchObject({ dailyMetrics: 0, ingestEvents: 0 });
  });
});

describe("ingest_events retention", () => {
  const event = (userId: string, receivedAt: Date) => ({
    userId,
    receivedAt,
    status: 200,
    authMethod: "bearer" as const,
    bytes: 10,
    durationMs: 5,
  });

  it("deletes events older than 90 days by default (received_at), keeps newer ones", async () => {
    const u = await makeUser("ing@example.com", "UTC");
    await db.insert(ingestEvents).values([
      event(u.id, new Date(NOW.getTime() - 91 * DAY_MS)),
      event(u.id, new Date(NOW.getTime() - 90 * DAY_MS - 1000)),
      event(u.id, new Date(NOW.getTime() - 89 * DAY_MS)),
      event(u.id, NOW),
    ]);
    const res = await runRetention(db, NOW, { avatarDir: dir });
    expect(res.ingestEvents).toBe(2);
    expect(await db.$count(ingestEvents)).toBe(2);
  });

  it("honours a custom window", async () => {
    const u = await makeUser("ing2@example.com", "UTC");
    await db.insert(ingestEvents).values([
      event(u.id, new Date(NOW.getTime() - 10 * DAY_MS)),
      event(u.id, new Date(NOW.getTime() - 6 * DAY_MS)),
    ]);
    const res = await runRetention(db, NOW, { avatarDir: dir, ingestLogRetentionDays: 7 });
    expect(res.ingestEvents).toBe(1);
    expect(await db.$count(ingestEvents)).toBe(1);
  });
});

describe("orphaned avatar files", () => {
  const HOUR = 3_600_000;
  const upload = (userId: string = randomUUID()) => `${userId}-${randomUUID().replace(/-/g, "").slice(0, 12)}.webp`;

  async function put(name: string, ageMs: number) {
    const file = path.join(dir, name);
    await writeFile(file, "x");
    const t = new Date(Date.now() - ageMs);
    await utimes(file, t, t);
  }

  it("removes only old, unreferenced files that match the upload naming pattern", async () => {
    const owner = await makeUser("owner@example.com", "UTC");
    const referenced = upload(owner.id);
    await db.update(users).set({ avatarKind: "upload", avatarPath: referenced }).where(eq(users.id, owner.id));

    const orphanOld = upload();
    const orphanRecent = upload();
    const orphanTmp = `${upload()}.4242.tmp`;
    await put(referenced, 48 * HOUR);
    await put(orphanOld, 3 * HOUR);
    await put(orphanRecent, 10 * 60_000);
    await put(orphanTmp, 3 * HOUR);
    // Never touched: names that don't match the upload pattern, however old.
    const strangers = ["notes.txt", "avatar.webp", "keep-me.webp", `${randomUUID()}.webp`, `${randomUUID()}-XYZ.webp`, ".gitkeep", `${orphanOld}.bak`];
    for (const s of strangers) await put(s, 100 * HOUR);
    // A directory whose name matches is not a file.
    await mkdir(path.join(dir, upload()));

    const res = await runRetention(db, new Date(), { avatarDir: dir });
    expect(res.avatarFiles).toBe(2);

    const left = new Set(await readdir(dir));
    expect(left.has(referenced)).toBe(true);
    expect(left.has(orphanRecent)).toBe(true);
    expect(left.has(orphanOld)).toBe(false);
    expect(left.has(orphanTmp)).toBe(false);
    for (const s of strangers) expect(left.has(s)).toBe(true);
  });

  it("treats a missing avatar directory as nothing to do", async () => {
    const res = await runRetention(db, NOW, { avatarDir: path.join(dir, "does-not-exist") });
    expect(res.avatarFiles).toBe(0);
  });
});
