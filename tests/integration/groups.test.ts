import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { dailyMetrics, dailyScores, groupMembers, groups, ingestEvents, users } from "@/db/schema";
import {
  getGroupFirstScoreDate,
  getGroupRecoveryTrend,
  getMemberGroup,
  getMembersToday,
  groupDateOf,
  isUuid,
  listMemberGroups,
} from "@/lib/groups/queries";
import { getGroupBoards } from "@/lib/scores/queries";
import { addDays } from "@/lib/tz";

// 21:30 UTC: still Sep 29 in New York (17:30) and Berlin (23:30), already Sep 30 in Kolkata (03:00).
// The groups below live in Europe/Berlin, so their "today" is Sep 29 for every member.
const NOW = new Date("2026-09-29T21:30:00Z");
const SEP29 = "2026-09-29";
const SEP30 = "2026-09-30";

async function person(name: string, timezone: string, extra: Partial<typeof users.$inferInsert> = {}) {
  const [u] = await db
    .insert(users)
    .values({ email: `${name}@example.com`, username: name, displayName: `${name[0].toUpperCase()}${name.slice(1)}`, timezone, onboardedAt: NOW, ...extra })
    .returning();
  return u.id;
}
async function group(name: string, memberIds: string[]) {
  const [g] = await db.insert(groups).values({ name, timezone: "Europe/Berlin" }).returning();
  for (const [i, userId] of memberIds.entries()) {
    await db.insert(groupMembers).values({ groupId: g.id, userId, joinedAt: new Date(NOW.getTime() - (10 - i) * 60_000) });
  }
  return g.id;
}
const score = (userId: string, localDate: string, v: { recovery?: number | null; strain?: number | null; sleepScore?: number | null }) =>
  db.insert(dailyScores).values({ userId, localDate, components: {}, ...v });
const metric = (userId: string, localDate: string) => db.insert(dailyMetrics).values({ userId, localDate });
const sync = (userId: string, at: string, status = 200) =>
  db.insert(ingestEvents).values({ userId, receivedAt: new Date(at), status, authMethod: "bearer", bytes: 10, durationMs: 5 });

describe("membership", () => {
  it("only members get the group; admins and outsiders get null, as do junk and unknown ids", async () => {
    const ann = await person("ann", "UTC");
    const admin = await person("root", "UTC", { isAdmin: true });
    const outsider = await person("zed", "UTC");
    const g = await group("Crew", [ann]);

    expect(await getMemberGroup(db, g, ann)).toEqual({ id: g, name: "Crew", timezone: "Europe/Berlin" });
    expect(await getMemberGroup(db, g, admin)).toBeNull();
    expect(await getMemberGroup(db, g, outsider)).toBeNull();
    expect(await getMemberGroup(db, "not-a-uuid", ann)).toBeNull();
    expect(await getMemberGroup(db, "00000000-0000-4000-8000-000000000000", ann)).toBeNull();
    expect(isUuid(g)).toBe(true);
    expect(isUuid("../etc")).toBe(false);
  });
});

describe("listMemberGroups / getMembersToday", () => {
  it("uses the group date (Berlin today) for every member, even one already on the next local day", async () => {
    const ny = await person("nia", "America/New_York");
    const berlin = await person("ben", "Europe/Berlin");
    const kolkata = await person("kai", "Asia/Kolkata");
    const metricsOnly = await person("mia", "America/New_York");
    const stale = await person("sam", "Europe/Berlin");
    const gone = await person("old", "UTC", { deactivatedAt: NOW });
    const other = await person("oth", "UTC");
    const crew = await group("Crew", [ny, berlin, kolkata, metricsOnly, stale, gone]);
    await group("Elsewhere", [other]);
    const second = await group("Runners", [ny]);

    expect(groupDateOf({ timezone: "Europe/Berlin" }, NOW)).toBe(SEP29);
    expect(groupDateOf({ timezone: "Asia/Kolkata" }, NOW)).toBe(SEP30);

    // Sep 29 rows for everyone (Kolkata too: its own Sep 29, though it is Sep 30 there now).
    await score(ny, SEP29, { recovery: 80, strain: 12.5, sleepScore: 90 });
    await score(berlin, SEP29, { recovery: 40, strain: null, sleepScore: 70 });
    await score(kolkata, SEP29, { recovery: 99, strain: 17.5, sleepScore: 80 });
    await score(kolkata, SEP30, { recovery: 1, strain: 1, sleepScore: 1 }); // Kolkata's own today: not the group date
    await metric(metricsOnly, SEP29); // raw metrics, no score yet: still has data
    await score(stale, "2026-09-28", { recovery: 10 }); // yesterday only: no data for the group date
    await metric(stale, "2026-09-28");
    await score(gone, SEP29, { recovery: 1 });

    await sync(stale, "2026-09-29T20:00:00Z"); // a sync alone doesn't count as data for the date

    const list = await listMemberGroups(db, ny, NOW);
    expect(list.map((g) => g.name)).toEqual(["Crew", "Runners"]);
    const [c, r] = list;
    expect(c.id).toBe(crew);
    expect(c.date).toBe(SEP29);
    expect(r.id).toBe(second);
    expect(c.members.map((m) => [m.username, m.date, m.hasData])).toEqual([
      ["nia", SEP29, true],
      ["ben", SEP29, true],
      ["kai", SEP29, true],
      ["mia", SEP29, true],
      ["sam", SEP29, false],
    ]);
    expect(c.members.find((m) => m.username === "kai")!.scores).toEqual({ recovery: 99, strain: 17.5, sleep: 80 });
    expect(c.members.find((m) => m.username === "mia")!.scores).toEqual({ recovery: null, strain: null, sleep: null });
    expect(c.members.find((m) => m.username === "sam")!.lastSyncAt).toEqual(new Date("2026-09-29T20:00:00Z"));
    expect(c.today).toEqual({
      recovery: { value: 73, n: 3 },
      strain: { value: 15, n: 2 },
      sleep: { value: 80, n: 3 },
      synced: 4,
      total: 5,
    });
    expect(r.members.map((m) => m.username)).toEqual(["nia"]);

    expect(await listMemberGroups(db, gone, NOW)).toHaveLength(1); // still a membership row, but...
    const ref = { id: crew, name: "Crew", timezone: "Europe/Berlin" };
    expect((await getMembersToday(db, [ref], NOW)).get(crew)!.some((m) => m.userId === gone)).toBe(false);
    expect(await listMemberGroups(db, await person("lonely", "UTC"), NOW)).toEqual([]);
  });

  it("follows the group timezone: the same instant is a different group date elsewhere", async () => {
    const kolkata = await person("kai", "Asia/Kolkata");
    const ny = await person("nia", "America/New_York");
    const [g] = await db.insert(groups).values({ name: "Delhi crew", timezone: "Asia/Kolkata" }).returning();
    for (const userId of [kolkata, ny]) await db.insert(groupMembers).values({ groupId: g.id, userId });
    await score(kolkata, SEP30, { recovery: 60 });
    await score(ny, SEP30, { recovery: 20 }); // New York hasn't reached Sep 30 yet, but this is its Sep 30 row
    await score(ny, SEP29, { recovery: 99 });

    const [got] = await listMemberGroups(db, ny, NOW);
    expect(got.date).toBe(SEP30);
    expect(got.members.map((m) => [m.username, m.date, m.scores.recovery])).toEqual([
      ["kai", SEP30, 60],
      ["nia", SEP30, 20],
    ]);
    expect(got.today.recovery).toEqual({ value: 40, n: 2 });
  });

  it("returns an empty list per group without members", async () => {
    const [g] = await db.insert(groups).values({ name: "Empty" }).returning();
    expect((await getMembersToday(db, [{ id: g.id, name: g.name, timezone: g.timezone }], NOW)).get(g.id)).toEqual([]);
  });
});

describe("group trend and first date", () => {
  it("averages recovery per local date over active members, nulls for empty days", async () => {
    const a = await person("ann", "UTC");
    const b = await person("bob", "UTC");
    const gone = await person("old", "UTC", { deactivatedAt: NOW });
    const outsider = await person("zed", "UTC");
    const g = await group("Crew", [a, b, gone]);
    await score(a, SEP29, { recovery: 70 });
    await score(b, SEP29, { recovery: 45 });
    await score(a, addDays(SEP29, -2), { recovery: 50 });
    await score(b, addDays(SEP29, -2), { recovery: null, strain: 3 });
    await score(gone, addDays(SEP29, -3), { recovery: 99 });
    await score(outsider, addDays(SEP29, -4), { recovery: 99 });
    await score(a, addDays(SEP29, -40), { strain: 2 });

    const trend = await getGroupRecoveryTrend(db, g, SEP29, 7);
    expect(trend.map((p) => p.date)).toEqual(Array.from({ length: 7 }, (_, i) => addDays(SEP29, i - 6)));
    expect(trend.at(-1)).toEqual({ date: SEP29, value: 57.5, n: 2 });
    expect(trend.at(-3)).toEqual({ date: addDays(SEP29, -2), value: 50, n: 1 });
    expect(trend.at(-4)).toEqual({ date: addDays(SEP29, -3), value: null, n: 0 }); // deactivated member ignored
    expect(trend.at(-5)!.value).toBeNull(); // outsider ignored

    expect(await getGroupFirstScoreDate(db, g)).toBe(addDays(SEP29, -40));
    const [empty] = await db.insert(groups).values({ name: "Empty" }).returning();
    expect(await getGroupFirstScoreDate(db, empty.id)).toBeNull();
  });
});

describe("getGroupBoards", () => {
  const MON = "2026-09-21";

  it("returns all three boards; a week lists members with 1-3 days as insufficient", async () => {
    const a = await person("ann", "UTC");
    const b = await person("bob", "UTC");
    const c = await person("cat", "UTC");
    const g = await group("Crew", [a, b, c]);
    for (let i = 0; i < 5; i++) await score(a, addDays(MON, i), { strain: 10, recovery: 60, sleepScore: 80 });
    for (let i = 0; i < 2; i++) await score(b, addDays(MON, i), { strain: 14, recovery: 90 });
    // cat: nothing this week

    const week = await getGroupBoards(db, g, "week", addDays(MON, 3));
    expect(week.strain.rows.map((r) => [r.username, r.value, r.days, r.rank])).toEqual([["ann", 10, 5, 1]]);
    expect(week.strain.insufficient.map((r) => [r.username, r.days])).toEqual([["bob", 2]]);
    expect(week.sleep.insufficient).toEqual([]);
    expect(week.recovery).toMatchObject({ metric: "recovery", period: "week", from: MON, to: addDays(MON, 6) });

    const day = await getGroupBoards(db, g, "day", MON);
    expect(day.strain.rows.map((r) => [r.username, r.rank])).toEqual([
      ["bob", 1],
      ["ann", 2],
    ]);
    expect(day.recovery.rows[0]).toMatchObject({ username: "bob", value: 90, avatarPath: null });
    expect(day.sleep.rows.map((r) => r.username)).toEqual(["ann"]);
    expect(day.strain.insufficient).toEqual([]);
  });

  it("ranks members in Berlin, Kolkata and New York on the Berlin date, each by their own local_date", async () => {
    const ber = await person("ben", "Europe/Berlin");
    const kol = await person("kai", "Asia/Kolkata");
    const nyc = await person("nia", "America/New_York");
    const g = await group("Crew", [ber, kol, nyc]);
    const date = groupDateOf({ timezone: "Europe/Berlin" }, NOW); // Sep 29; Kolkata is already on Sep 30
    expect(date).toBe(SEP29);
    await score(ber, SEP29, { strain: 10 });
    await score(kol, SEP29, { strain: 14 });
    await score(kol, SEP30, { strain: 20 }); // Kolkata's next day: not part of the Berlin date
    await score(nyc, SEP29, { strain: 12 });

    const day = await getGroupBoards(db, g, "day", date);
    expect(day.strain.rows.map((r) => [r.username, r.value])).toEqual([
      ["kai", 14],
      ["nia", 12],
      ["ben", 10],
    ]);
    // Week board: the Monday-Sunday week containing the group date.
    const week = await getGroupBoards(db, g, "week", date);
    expect([week.strain.from, week.strain.to]).toEqual(["2026-09-28", "2026-10-04"]);
    expect(week.strain.rows).toHaveLength(0);
    expect(week.strain.insufficient.map((r) => [r.username, r.days])).toEqual([
      ["kai", 2],
      ["ben", 1],
      ["nia", 1],
    ]);
  });
});
