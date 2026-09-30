import { describe, expect, it } from "vitest";
import {
  championsSchedule,
  computeChampions,
  isMonday,
  lastCompletedWeek,
  type ChampionDay,
  type ChampionMember,
} from "@/lib/champions/compute";
import { parseChampionsPayload, payloadUserIds, weekLabel } from "@/lib/champions/types";
import { addDays } from "@/lib/tz";

const WEEK = "2026-09-21"; // Monday

function member(id: string, displayName: string | null, username: string | null = null): ChampionMember {
  return { userId: id, displayName, username, avatarKind: null, avatarConfig: null, avatarPath: null };
}

/** `n` consecutive days from `from` with the given values. */
function days(userId: string, from: string, n: number, v: Omit<ChampionDay, "userId" | "date">): ChampionDay[] {
  return Array.from({ length: n }, (_, i) => ({ userId, date: addDays(from, i), ...v }));
}

const compute = (members: ChampionMember[], d: ChampionDay[]) =>
  computeChampions({ groupId: "g", groupName: "Crew", weekStart: WEEK, members, days: d });

describe("championsSchedule (group timezone)", () => {
  it("last completed week and the Monday 09:00 cut-off in the group's timezone", () => {
    // Mon Sep 28 2026 08:59 in Berlin (CEST, UTC+2) = 06:59Z.
    expect(championsSchedule("Europe/Berlin", new Date("2026-09-28T06:59:00Z"))).toEqual({
      today: "2026-09-28",
      weekStart: "2026-09-21",
      due: false,
    });
    expect(championsSchedule("Europe/Berlin", new Date("2026-09-28T07:00:00Z")).due).toBe(true);
    // Tuesday: still last week, still due (catch-up).
    expect(championsSchedule("Europe/Berlin", new Date("2026-09-29T20:00:00Z"))).toEqual({
      today: "2026-09-29",
      weekStart: "2026-09-21",
      due: true,
    });
    // Sunday night is still inside the current week: last completed week = the week before.
    expect(lastCompletedWeek("Europe/Berlin", new Date("2026-09-27T21:59:00Z"))).toBe("2026-09-14");
    expect(lastCompletedWeek("Europe/Berlin", new Date("2026-09-27T22:00:00Z"))).toBe("2026-09-21");
  });

  it("uses the group's zone, not UTC: Kolkata is already on Monday while UTC is still Sunday", () => {
    const at = new Date("2026-09-27T20:00:00Z"); // Mon 01:30 in Kolkata, Sun 20:00 UTC
    expect(championsSchedule("Asia/Kolkata", at)).toMatchObject({ today: "2026-09-28", weekStart: "2026-09-21", due: false });
    expect(championsSchedule("UTC", at)).toMatchObject({ today: "2026-09-27", weekStart: "2026-09-14", due: true });
    expect(championsSchedule("", at).today).toBe("2026-09-27"); // blank = UTC
  });

  it("DST end (Europe/Berlin, last Sunday of October): the week Oct 19-25 closes at local midnight and posts at 09:00 CET", () => {
    // Oct 25 2026 is the switch (CEST -> CET at 03:00). Sunday 23:59 CET = 22:59Z: still that week.
    expect(lastCompletedWeek("Europe/Berlin", new Date("2026-10-25T22:59:00Z"))).toBe("2026-10-12");
    expect(lastCompletedWeek("Europe/Berlin", new Date("2026-10-25T23:00:00Z"))).toBe("2026-10-19");
    // Monday 08:59 CET = 07:59Z (was 06:59Z the week before, in CEST).
    expect(championsSchedule("Europe/Berlin", new Date("2026-10-26T07:59:00Z"))).toMatchObject({ weekStart: "2026-10-19", due: false });
    expect(championsSchedule("Europe/Berlin", new Date("2026-10-26T08:00:00Z"))).toMatchObject({ weekStart: "2026-10-19", due: true });
    expect(weekLabel("2026-10-19")).toBe("OCT 19 – 25");
  });

  it("DST start (last Sunday of March): Monday 09:00 CEST = 07:00Z", () => {
    expect(championsSchedule("Europe/Berlin", new Date("2026-03-30T06:59:00Z"))).toMatchObject({ weekStart: "2026-03-23", due: false });
    expect(championsSchedule("Europe/Berlin", new Date("2026-03-30T07:00:00Z")).due).toBe(true);
  });

  it("week labels and Monday checks", () => {
    expect(weekLabel("2026-09-21")).toBe("SEP 21 – 27");
    expect(weekLabel("2026-09-28")).toBe("SEP 28 – OCT 4");
    expect(isMonday("2026-09-21")).toBe(true);
    expect(isMonday("2026-09-22")).toBe(false);
    expect(isMonday("nope")).toBe(false);
  });
});

describe("computeChampions", () => {
  it("ranks each category over the group week with the >= 4 day rule and top-3 lists", () => {
    const ann = member("a", "Ann");
    const ben = member("b", "Ben");
    const cat = member("c", "Cat");
    const dan = member("d", "Dan"); // only 3 days: never ranked
    const facts = compute(
      [ann, ben, cat, dan],
      [
        ...days("a", WEEK, 7, { sleep: 90, recovery: 80, strain: 10, steps: 10_000 }),
        ...days("b", WEEK, 5, { sleep: 70, recovery: 60, strain: 15, steps: 20_000 }),
        ...days("c", WEEK, 4, { sleep: 80, recovery: 70, strain: 12, steps: 9_000 }),
        ...days("d", WEEK, 3, { sleep: 100, recovery: 100, strain: 21, steps: 90_000 }),
        // Outside the week: ignored (except the prior week for "improved").
        ...days("b", addDays(WEEK, 7), 3, { sleep: 100, recovery: 100, strain: 21, steps: 99_999 }),
      ],
    )!;
    expect(facts.weekLabel).toBe("SEP 21 – 27");
    expect(facts.eligible).toBe(3);
    const by = Object.fromEntries(facts.categories.map((c) => [c.category, c]));
    expect(Object.keys(by)).toEqual(["recovery", "strain", "sleep", "steps"]); // nobody has a prior week: no "improved"
    expect(by.sleep.winners.map((w) => w.userId)).toEqual(["a"]);
    expect(by.sleep.runnersUp.map((w) => [w.userId, w.value])).toEqual([["c", 80], ["b", 70]]);
    expect(by.strain.winners[0]).toMatchObject({ userId: "b", value: 15, unit: "", days: 5, displayName: "Ben" });
    expect(by.recovery.winners[0]).toMatchObject({ userId: "a", value: 80, unit: "%" });
    expect(by.steps.winners[0]).toMatchObject({ userId: "b", value: 100_000, unit: "steps" }); // 5 x 20k
    expect(by.steps.runnersUp.map((r) => r.value)).toEqual([70_000, 36_000]);
    for (const c of facts.categories) expect([...c.winners, ...c.runnersUp].some((e) => e.userId === "d")).toBe(false);
  });

  it("means are compared at display precision (1 decimal)", () => {
    const f = compute(
      [member("a", "Ann"), member("b", "Ben")],
      [
        ...days("a", WEEK, 4, { recovery: 70.04 }),
        ...days("b", WEEK, 4, { recovery: 70.01 }), // both 70.0 -> tie -> name
      ],
    )!;
    expect(f.categories[0].winners[0].userId).toBe("a");
    expect(f.categories[0].winners[0].value).toBe(70);
  });

  it("tiebreak: equal value -> more days -> name (case-insensitive) -> id", () => {
    const moreDays = compute(
      [member("a", "Ann"), member("z", "Zed")],
      [...days("a", WEEK, 4, { strain: 12 }), ...days("z", WEEK, 6, { strain: 12 })],
    )!;
    expect(moreDays.categories[0].winners[0].userId).toBe("z");

    const byName = compute(
      [member("1", "bea"), member("2", "Adam")],
      [...days("1", WEEK, 5, { strain: 12 }), ...days("2", WEEK, 5, { strain: 12 })],
    )!;
    expect(byName.categories[0].winners[0].displayName).toBe("Adam");
    expect(byName.categories[0].runnersUp[0].displayName).toBe("bea");

    const byId = compute(
      [member("b-id", "Sam"), member("a-id", "Sam")],
      [...days("b-id", WEEK, 5, { strain: 12 }), ...days("a-id", WEEK, 5, { strain: 12 })],
    )!;
    expect(byId.categories[0].winners[0].userId).toBe("a-id");
  });

  it("improved = this week's mean recovery minus last week's (both >= 4 days, positive gains only)", () => {
    const prior = addDays(WEEK, -7);
    const f = compute(
      [member("a", "Ann"), member("b", "Ben"), member("c", "Cat"), member("d", "Dan")],
      [
        ...days("a", prior, 4, { recovery: 50 }),
        ...days("a", WEEK, 4, { recovery: 62.5 }), // +12.5
        ...days("b", prior, 7, { recovery: 40 }),
        ...days("b", WEEK, 7, { recovery: 70 }), // +30
        ...days("c", prior, 3, { recovery: 10 }), // prior week too short
        ...days("c", WEEK, 7, { recovery: 90 }),
        ...days("d", prior, 5, { recovery: 80 }),
        ...days("d", WEEK, 5, { recovery: 60 }), // went down: not a candidate
      ],
    )!;
    const improved = f.categories.find((c) => c.category === "improved")!;
    expect(improved.winners[0]).toMatchObject({ userId: "b", value: 30, from: 40, to: 70, unit: "pts" });
    expect(improved.runnersUp.map((r) => [r.userId, r.value])).toEqual([["a", 12.5]]);
  });

  it("uses members' names with the username / 'Member' fallback", () => {
    const f = compute(
      [member("a", "  ", "ann_u"), member("b", null, null)],
      [...days("a", WEEK, 4, { sleep: 80 }), ...days("b", WEEK, 4, { sleep: 70 })],
    )!;
    expect(f.categories[0].winners[0].displayName).toBe("ann_u");
    expect(f.categories[0].runnersUp[0].displayName).toBe("Member");
  });

  it("no post with fewer than 2 qualifying members; empty categories are skipped", () => {
    expect(compute([member("a", "Ann"), member("b", "Ben")], [...days("a", WEEK, 7, { sleep: 90 }), ...days("b", WEEK, 3, { sleep: 90 })])).toBeNull();
    expect(compute([member("a", "Ann")], days("a", WEEK, 7, { sleep: 90 }))).toBeNull();
    // Two members qualify in different categories: that's enough.
    const f = compute(
      [member("a", "Ann"), member("b", "Ben")],
      [...days("a", WEEK, 4, { sleep: 90 }), ...days("b", WEEK, 4, { steps: 5000 })],
    )!;
    expect(f.categories.map((c) => c.category)).toEqual(["sleep", "steps"]);
    expect(f.categories[0].runnersUp).toEqual([]);
    // Data from someone who isn't a member is ignored.
    expect(compute([member("a", "Ann")], [...days("a", WEEK, 4, { sleep: 90 }), ...days("x", WEEK, 4, { sleep: 99 })])).toBeNull();
  });
});

describe("parseChampionsPayload", () => {
  it("accepts a stored payload and drops malformed parts", () => {
    const raw = {
      v: 1,
      weekStart: WEEK,
      weekLabel: "SEP 21 – 27",
      source: "gemini",
      categories: [
        { category: "sleep", winners: [{ userId: "a", displayName: "Ann", value: 90, unit: "%", days: 7 }], runnersUp: [{ bad: true }] },
        { category: "bogus", winners: [{ userId: "b", value: 1 }] },
        { category: "strain", winners: [] },
      ],
      deletedUserIds: ["a", 7],
    };
    const p = parseChampionsPayload(raw)!;
    expect(p.source).toBe("gemini");
    expect(p.categories).toHaveLength(1);
    expect(p.categories[0].winners[0]).toMatchObject({ userId: "a", displayName: "Ann", value: 90 });
    expect(p.categories[0].runnersUp).toEqual([]);
    expect(p.deletedUserIds).toEqual(["a"]);
    expect(parseChampionsPayload({ v: 2 })).toBeNull();
    expect(parseChampionsPayload(null)).toBeNull();
    expect(payloadUserIds(raw)).toEqual(["a", "b"]);
  });
});
