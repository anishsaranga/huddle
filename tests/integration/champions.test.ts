import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db, sql } from "@/db";
import { championAwards, dailyMetrics, dailyScores, groupMembers, groups, messages, users } from "@/db/schema";
import { dryRunChampions, getChampionsAdminStatus } from "@/lib/champions/admin";
import { getActiveFlair } from "@/lib/champions/flair";
import { templateGenerator, type ChampionsGenerator } from "@/lib/champions/generate";
import { postWeeklyChampions } from "@/lib/champions/post";
import { parseChampionsPayload } from "@/lib/champions/types";
import { groupChannel } from "@/lib/chat/notify";
import { listMessages } from "@/lib/chat/service";
import { createLogger } from "@/lib/log";
import { addDays } from "@/lib/tz";
import { createJobRegistry, type JobContext } from "@/worker/registry";
import { jobs } from "@/worker/jobs";
import { runChampionsJob } from "@/worker/jobs/champions";
import { runRetentionJob } from "@/worker/jobs/retention";

const quiet = () => createLogger({ write() {} }, { level: "silent" });
const ctx = (now: Date): JobContext => ({ db, log: quiet(), now: () => now });

const WEEK = "2026-09-21"; // Mon; the group week Sep 21-27 (Europe/Berlin)
// Mon Sep 28 2026, 09:00 in Berlin (CEST, UTC+2).
const MON_0900 = new Date("2026-09-28T07:00:00Z");

async function person(name: string, extra: Partial<typeof users.$inferInsert> = {}) {
  const [u] = await db
    .insert(users)
    .values({ email: `${name}@example.com`, username: name, displayName: name[0].toUpperCase() + name.slice(1), timezone: "Europe/Berlin", onboardedAt: new Date(), ...extra })
    .returning();
  return u.id;
}

async function group(name: string, memberIds: string[], timezone = "Europe/Berlin") {
  const [g] = await db.insert(groups).values({ name, timezone }).returning();
  if (memberIds.length) await db.insert(groupMembers).values(memberIds.map((userId) => ({ groupId: g.id, userId })));
  return g.id;
}

/** `n` days of scores (and steps) from `from`. */
async function week(userId: string, from: string, n: number, v: { sleep?: number; recovery?: number; strain?: number; steps?: number }) {
  for (let i = 0; i < n; i++) {
    const localDate = addDays(from, i);
    await db.insert(dailyScores).values({ userId, localDate, sleepScore: v.sleep ?? null, recovery: v.recovery ?? null, strain: v.strain ?? null, components: {} });
    if (v.steps !== undefined) await db.insert(dailyMetrics).values({ userId, localDate, steps: v.steps });
  }
}

/** A Berlin group with three qualifying members (and one without enough days). */
async function crew() {
  const ann = await person("ann");
  const ben = await person("ben");
  const cat = await person("cat");
  const dan = await person("dan");
  const g = await group("Crew", [ann, ben, cat, dan]);
  await week(ann, WEEK, 7, { sleep: 90, recovery: 80, strain: 10, steps: 12_000 });
  await week(ben, WEEK, 5, { sleep: 70, recovery: 60, strain: 15, steps: 20_000 });
  await week(cat, WEEK, 4, { sleep: 80, recovery: 70, strain: 12, steps: 8_000 });
  await week(cat, addDays(WEEK, -7), 4, { recovery: 50 }); // cat improved by 20
  await week(dan, WEEK, 3, { sleep: 99, recovery: 99, strain: 20 });
  return { g, ann, ben, cat, dan };
}

const counting = (): ChampionsGenerator & { calls: number } => {
  const gen = (async (facts) => {
    gen.calls++;
    return templateGenerator(facts);
  }) as ChampionsGenerator & { calls: number };
  gen.calls = 0;
  return gen;
};

describe("postWeeklyChampions", () => {
  it("posts one champions message with awards and a payload, notifies the group, and is idempotent", async () => {
    const { g, ann, ben, cat } = await crew();
    const heard: string[] = [];
    const listener = await sql.listen(groupChannel(g), (p) => heard.push(p));
    try {
      const gen = counting();
      const first = await postWeeklyChampions(db, g, WEEK, { generate: gen, log: quiet() });
      expect(first).toMatchObject({ status: "posted", weekStart: WEEK, source: "template", awards: 5 });
      const second = await postWeeklyChampions(db, g, WEEK, { generate: gen, log: quiet() });
      expect(second).toMatchObject({ status: "already_posted", weekStart: WEEK });
      expect(gen.calls).toBe(1); // the second run doesn't even generate

      const msgs = await db.select().from(messages).where(eq(messages.groupId, g));
      expect(msgs).toHaveLength(1);
      const [msg] = msgs;
      expect(msg).toMatchObject({ kind: "champions", userId: null });
      expect(msg.body).toContain("Ann");
      if (first.status !== "posted") throw new Error("unreachable");
      expect(msg.id).toBe(first.messageId);

      const awards = await db.select().from(championAwards).where(eq(championAwards.groupId, g));
      expect(awards.map((a) => [a.category, a.userId, a.value, a.messageId]).sort()).toEqual(
        [
          ["recovery", ann, 80, msg.id],
          ["strain", ben, 15, msg.id],
          ["sleep", ann, 90, msg.id],
          ["steps", ben, 100_000, msg.id],
          ["improved", cat, 20, msg.id],
        ].sort(),
      );
      expect(awards.every((a) => a.weekStart === WEEK)).toBe(true);

      const payload = parseChampionsPayload(msg.payload)!;
      expect(msg.payload).toMatchObject({ v: 1, weekStart: WEEK, weekLabel: "SEP 21 – 27", source: "template" });
      expect(payload.categories.map((c) => c.category)).toEqual(["recovery", "strain", "sleep", "steps", "improved"]);
      const sleep = payload.categories.find((c) => c.category === "sleep")!;
      expect(sleep.winners[0]).toMatchObject({ userId: ann, displayName: "Ann", username: "ann", value: 90, unit: "%", days: 7 });
      expect(sleep.runnersUp.map((r) => r.userId)).toEqual([cat, ben]);
      expect(JSON.stringify(msg.payload)).not.toContain("@example.com");

      // NOTIFY on commit, exactly once, with the numeric id.
      await expect.poll(() => heard.length).toBe(1);
      expect(JSON.parse(heard[0])).toEqual({ type: "message", id: msg.id });
    } finally {
      await listener.unlisten();
    }
  });

  it("concurrent posters (worker + admin) still produce one post", async () => {
    const { g } = await crew();
    const results = await Promise.all([1, 2, 3].map(() => postWeeklyChampions(db, g, WEEK, { generate: templateGenerator, log: quiet() })));
    expect(results.filter((r) => r.status === "posted")).toHaveLength(1);
    expect(await db.select().from(messages).where(eq(messages.groupId, g))).toHaveLength(1);
    expect(await db.select().from(championAwards).where(eq(championAwards.groupId, g))).toHaveLength(5);
  });

  it("skips groups with fewer than 2 qualifying members; rejects a non-Monday week", async () => {
    const solo = await person("solo");
    const other = await person("other");
    const g = await group("Tiny", [solo, other]);
    await week(solo, WEEK, 7, { sleep: 80 });
    await week(other, WEEK, 2, { sleep: 80 });
    expect(await postWeeklyChampions(db, g, WEEK, { generate: templateGenerator, log: quiet() })).toEqual({
      status: "skipped",
      weekStart: WEEK,
      reason: "not_enough_data",
    });
    expect(await db.select().from(messages)).toHaveLength(0);
    await expect(postWeeklyChampions(db, g, "2026-09-22", { generate: templateGenerator })).rejects.toThrow(/Monday/);
    expect(await postWeeklyChampions(db, "00000000-0000-4000-8000-000000000000", WEEK, { generate: templateGenerator })).toMatchObject({
      status: "skipped",
      reason: "no_group",
    });
  });

  it("leaves deactivated members out, and the chat marks winners whose account was deleted", async () => {
    const { g, ann, ben } = await crew();
    await db.update(users).set({ deactivatedAt: new Date() }).where(eq(users.id, ben));
    await postWeeklyChampions(db, g, WEEK, { generate: templateGenerator, log: quiet() });
    const [msg] = await db.select().from(messages).where(eq(messages.groupId, g));
    expect(JSON.stringify(msg.payload)).not.toContain(ben);

    // Ann deletes her account: her awards go (cascade), the post stays, readers see her as deleted.
    const viewer = await person("viewer");
    await db.insert(groupMembers).values({ groupId: g, userId: viewer });
    await db.delete(users).where(eq(users.id, ann));
    expect(await db.select().from(championAwards).where(eq(championAwards.userId, ann))).toHaveLength(0);
    const page = await listMessages(db, g, viewer);
    const card = page!.messages.find((m) => m.kind === "champions")!;
    expect(parseChampionsPayload(card.payload)!.deletedUserIds).toEqual([ann]);
    // Still "posted" for that week (no second post after awards vanished).
    expect(await postWeeklyChampions(db, g, WEEK, { generate: templateGenerator, log: quiet() })).toMatchObject({ status: "already_posted" });
  });
});

describe("champions job", () => {
  it("posts from Monday 09:00 group time, catches up later in the week, and never twice", async () => {
    const { g } = await crew();
    const gen = counting();
    const run = (at: Date) => runChampionsJob(ctx(at), { generate: gen });

    // Mon 08:59 Berlin: not yet.
    let runs = await run(new Date(MON_0900.getTime() - 60_000));
    expect(runs).toEqual([{ groupId: g, result: { status: "not_due", weekStart: WEEK } }]);
    expect(await db.select().from(messages)).toHaveLength(0);

    // 09:00: posted (message created at the job's clock).
    runs = await run(MON_0900);
    expect(runs[0].result).toMatchObject({ status: "posted", weekStart: WEEK });
    const [msg] = await db.select().from(messages);
    expect(msg.createdAt).toEqual(MON_0900);

    // Next hour: no-op.
    runs = await run(new Date(MON_0900.getTime() + 3_600_000));
    expect(runs[0].result).toMatchObject({ status: "already_posted" });
    expect(await db.select().from(messages)).toHaveLength(1);
    expect(gen.calls).toBe(1);
  });

  it("catches up on Tuesday when Monday's runs were missed; each group uses its own timezone", async () => {
    const { g } = await crew();
    // A Kolkata group whose Monday 09:00 (03:30Z) has passed, and a Los Angeles group still on Sunday.
    const k1 = await person("kay", { timezone: "Asia/Kolkata" });
    const k2 = await person("kim", { timezone: "Asia/Kolkata" });
    const kolkata = await group("Kolkata", [k1, k2], "Asia/Kolkata");
    await week(k1, WEEK, 4, { sleep: 70 });
    await week(k2, WEEK, 4, { sleep: 75 });
    const la = await group("LA", [], "America/Los_Angeles");

    const monday0400z = new Date("2026-09-28T04:00:00Z"); // Kolkata Mon 09:30, Berlin Mon 06:00, LA Sun 21:00
    const runs = await runChampionsJob(ctx(monday0400z), { generate: templateGenerator });
    const by = Object.fromEntries(runs.map((r) => [r.groupId, r.result.status]));
    expect(by).toEqual({ [g]: "not_due", [kolkata]: "posted", [la]: "skipped" });
    // LA is due for *its* last completed week (Sep 14-20) on Sunday, which has no data: skipped.
    expect(runs.find((r) => r.groupId === la)!.result).toMatchObject({ weekStart: "2026-09-14" });

    const tuesday = new Date("2026-09-29T12:00:00Z");
    const later = await runChampionsJob(ctx(tuesday), { generate: templateGenerator });
    expect(Object.fromEntries(later.map((r) => [r.groupId, r.result.status]))).toEqual({
      [g]: "posted",
      [kolkata]: "already_posted",
      [la]: "skipped",
    });
    expect(await db.select().from(messages)).toHaveLength(2);
  });

  it("a failing group doesn't block the others; the registry records the error", async () => {
    const { g } = await crew();
    const other = await crew2();
    const flaky: ChampionsGenerator = async (facts) => {
      if (facts.groupId === g) throw new Error("generator exploded");
      return templateGenerator(facts);
    };
    const registry = createJobRegistry({ db, log: quiet(), now: () => MON_0900 });
    registry.registerJob({ name: "champions", cron: "5 * * * *", run: (c) => runChampionsJob(c, { generate: flaky }).then(() => {}) });
    const r = await registry.runJob("champions");
    expect(r).toMatchObject({ status: "error", error: "champions: 1 group(s) failed" });
    const posted = await db.select({ groupId: messages.groupId }).from(messages);
    expect(posted.map((p) => p.groupId)).toEqual([other]);
    expect(posted.map((p) => p.groupId)).not.toContain(g);
    // The next hourly run retries the failed group.
    expect((await runChampionsJob(ctx(new Date(MON_0900.getTime() + 3_600_000)), { generate: templateGenerator }))[0].result.status).toBe("posted");
  });

  it("both jobs are registered with valid schedules", () => {
    expect(jobs.map((j) => [j.name, j.cron])).toEqual(
      expect.arrayContaining([
        ["champions", "5 * * * *"],
        ["retention", "17 3 * * *"],
      ]),
    );
  });
});

/** A second qualifying group (created after `crew`). */
async function crew2() {
  const a = await person("xa");
  const b = await person("xb");
  const g = await group("Crew 2", [a, b]);
  await week(a, WEEK, 4, { strain: 9 });
  await week(b, WEEK, 4, { strain: 11 });
  return g;
}

describe("retention job", () => {
  it("runs runRetention with the job's clock", async () => {
    const u = await person("old");
    const now = new Date("2026-09-29T12:00:00Z");
    await db.insert(dailyMetrics).values([
      { userId: u, localDate: addDays("2026-09-29", -365), steps: 1 },
      { userId: u, localDate: addDays("2026-09-29", -364), steps: 2 },
    ]);
    const result = await runRetentionJob(ctx(now));
    expect(result.dailyMetrics).toBe(1);
    const left = await db.select({ d: dailyMetrics.localDate }).from(dailyMetrics).where(eq(dailyMetrics.userId, u));
    expect(left.map((r) => r.d)).toEqual([addDays("2026-09-29", -364)]);
    expect(jobs.find((j) => j.name === "retention")).toBeDefined();
  });
});

describe("flair", () => {
  it("maps the latest week's winners to their titles until it expires", async () => {
    const { g, ann, ben, cat, dan } = await crew();
    await postWeeklyChampions(db, g, WEEK, { generate: templateGenerator, log: quiet() });

    expect(await getActiveFlair(db, [ann, ben, cat, dan], g, MON_0900)).toEqual({
      [ann]: ["recovery", "sleep"],
      [ben]: ["strain", "steps"],
      [cat]: ["improved"],
    });
    // Without a group: every group the users are champions in.
    expect(Object.keys(await getActiveFlair(db, [ann, dan], undefined, MON_0900))).toEqual([ann]);
    expect(await getActiveFlair(db, [], g, MON_0900)).toEqual({});

    // Still shown the next Monday morning, before the new post...
    expect(Object.keys(await getActiveFlair(db, [ann], g, new Date("2026-10-05T06:00:00Z")))).toEqual([ann]);
    // ...but not a week later, if nothing replaced it.
    expect(await getActiveFlair(db, [ann], g, new Date("2026-10-12T06:00:00Z"))).toEqual({});

    // A newer week replaces the older one entirely.
    const next = addDays(WEEK, 7);
    await db.insert(championAwards).values({ groupId: g, weekStart: next, category: "sleep", userId: dan, value: 1 });
    expect(await getActiveFlair(db, [ann, dan], g, new Date("2026-10-05T08:00:00Z"))).toEqual({ [dan]: ["sleep"] });
  });
});

describe("admin", () => {
  it("dry run computes and generates without writing; status reflects the post", async () => {
    const { g } = await crew();
    const before = await getChampionsAdminStatus(db, g, MON_0900);
    expect(before).toMatchObject({ lastPost: null, weekStart: WEEK, weekLabel: "SEP 21 – 27", posted: false, due: true });

    const dry = await dryRunChampions(db, g, { now: MON_0900, generate: templateGenerator });
    expect(dry).toMatchObject({ ok: true, weekStart: WEEK, source: "template", alreadyPosted: false, eligible: 3 });
    if (!dry.ok) throw new Error("unreachable");
    expect(dry.text).toContain("Ann");
    expect(await db.select().from(messages)).toHaveLength(0);
    expect(await db.select().from(championAwards)).toHaveLength(0);

    await postWeeklyChampions(db, g, WEEK, { generate: templateGenerator, now: MON_0900, log: quiet() });
    const after = await getChampionsAdminStatus(db, g, MON_0900);
    expect(after).toMatchObject({ posted: true, lastPost: { at: MON_0900.toISOString(), weekStart: WEEK, source: "template" } });
    expect(await dryRunChampions(db, g, { now: MON_0900, generate: templateGenerator })).toMatchObject({ alreadyPosted: true });

    const lonely = await group("Lonely", []);
    expect(await dryRunChampions(db, lonely, { now: MON_0900, generate: templateGenerator })).toMatchObject({ ok: false, reason: "not_enough_data" });
    expect(await getChampionsAdminStatus(db, "00000000-0000-4000-8000-000000000000")).toBeNull();
    expect(await db.select().from(championAwards).where(and(eq(championAwards.groupId, lonely)))).toHaveLength(0);
  });
});
