import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { dailyScores, groupMembers, groups, ingestEvents, users } from "@/db/schema";
import {
  getGroupFirstScoreDate,
  getGroupRecoveryTrend,
  getMemberGroup,
  getMembersToday,
  isUuid,
  listMemberGroups,
} from "@/lib/groups/queries";
import { getGroupBoards } from "@/lib/scores/queries";
import { addDays } from "@/lib/tz";

// 21:30 UTC: still Sep 29 in New York and Berlin (23:30), already Sep 30 in Kolkata (03:00).
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
  it("lists only the user's groups with each member's own today, averages and synced flags", async () => {
    const ny = await person("nia", "America/New_York");
    const berlin = await person("ben", "Europe/Berlin");
    const kolkata = await person("kai", "Asia/Kolkata");
    const gone = await person("old", "UTC", { deactivatedAt: NOW });
    const other = await person("oth", "UTC");
    const crew = await group("Crew", [ny, berlin, kolkata, gone]);
    await group("Elsewhere", [other]);
    const second = await group("Runners", [ny]);

    // Sep 29 rows for everyone; Kolkata is already on Sep 30 (no row yet).
    await score(ny, SEP29, { recovery: 80, strain: 12.5, sleepScore: 90 });
    await score(berlin, SEP29, { recovery: 40, strain: null, sleepScore: 70 });
    await score(kolkata, SEP29, { recovery: 99, strain: 20, sleepScore: 99 });
    await score(gone, SEP29, { recovery: 1 });
    await score(ny, "2026-09-28", { recovery: 10 });

    await sync(ny, "2026-09-29T12:00:00Z"); // NY Sep 29 -> today
    await sync(berlin, "2026-09-28T21:00:00Z"); // Berlin Sep 28 23:00 -> not today
    await sync(berlin, "2026-09-29T20:00:00Z", 400); // failed attempts don't count
    await sync(kolkata, "2026-09-29T19:00:00Z"); // Kolkata Sep 30 00:30 -> today

    const list = await listMemberGroups(db, ny, NOW);
    expect(list.map((g) => g.name)).toEqual(["Crew", "Runners"]);
    const [c, r] = list;
    expect(c.id).toBe(crew);
    expect(r.id).toBe(second);
    expect(c.members.map((m) => [m.username, m.today, m.syncedToday])).toEqual([
      ["nia", SEP29, true],
      ["ben", SEP29, false],
      ["kai", SEP30, true],
    ]);
    expect(c.members.find((m) => m.username === "kai")!.scores).toEqual({ recovery: null, strain: null, sleep: null });
    expect(c.members.find((m) => m.username === "ben")!.lastSyncAt).toEqual(new Date("2026-09-28T21:00:00Z"));
    expect(c.today).toEqual({
      recovery: { value: 60, n: 2 },
      strain: { value: 12.5, n: 1 },
      sleep: { value: 80, n: 2 },
      synced: 2,
      total: 3,
    });
    expect(r.members.map((m) => m.username)).toEqual(["nia"]);

    expect(await listMemberGroups(db, gone, NOW)).toHaveLength(1); // still a membership row, but...
    expect((await getMembersToday(db, [crew], NOW)).get(crew)!.some((m) => m.userId === gone)).toBe(false);
    expect(await listMemberGroups(db, await person("lonely", "UTC"), NOW)).toEqual([]);
  });

  it("returns an empty list per group without members", async () => {
    const [g] = await db.insert(groups).values({ name: "Empty" }).returning();
    expect((await getMembersToday(db, [g.id], NOW)).get(g.id)).toEqual([]);
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
});
