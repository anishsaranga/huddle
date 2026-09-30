import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import {
  apiKeys,
  championAwards,
  dailyMetrics,
  dailyScores,
  groupMembers,
  groups,
  hrHourly,
  ingestEvents,
  messages,
  reactions,
  sleepNights,
  sleepSegments,
  users,
} from "@/db/schema";
import { EXPORT_SECTIONS, exportFilename, getExportLimiter } from "@/lib/account/export";

const session = vi.hoisted(() => ({ user: null as null | { id: string } }));
vi.mock("@/lib/session", () => ({ getCurrentUser: async () => session.user }));

const { GET } = await import("@/app/api/me/export/route");

beforeEach(() => {
  session.user = null;
  getExportLimiter().reset();
});

const KEY_HASH = "f".repeat(64);
const OTHER_HASH = "e".repeat(64);

async function seedUser(email: string, username: string, hash: string, marker: string) {
  const [u] = await db
    .insert(users)
    .values({
      email,
      name: `Name ${marker}`,
      username,
      displayName: `Display ${marker}`,
      timezone: "Europe/Berlin",
      units: "metric",
      dob: "1990-05-05",
      sex: "female",
      heightCm: 170,
      weightKg: 62.5,
      stepGoal: 9000,
      sleepGoalMin: 465,
      avatarKind: "dicebear",
      avatarConfig: { v: 1, style: "avataaars", seed: "s", options: {} },
      onboardedAt: new Date("2026-01-01T00:00:00Z"),
    })
    .returning();
  const id = u.id;
  await db.insert(apiKeys).values([
    { userId: id, hash: `old${hash}`.slice(0, 64), prefixHint: "gk_oldkk", revokedAt: new Date("2026-02-01T00:00:00Z") },
    { userId: id, hash, prefixHint: "gk_newkk", lastUsedAt: new Date("2026-09-28T08:00:00Z") },
  ]);
  const [g] = await db.insert(groups).values({ name: `Group ${marker}`, timezone: "Europe/Berlin" }).returning();
  await db.insert(groupMembers).values({ groupId: g.id, userId: id });
  await db.insert(dailyMetrics).values([
    { userId: id, localDate: "2026-09-27", steps: 1111, resting_hr: 51.5 },
    { userId: id, localDate: "2026-09-28", steps: 2222 },
  ]);
  await db.insert(hrHourly).values([
    { userId: id, localDate: "2026-09-28", hour: 3, avg: 55, min: 50, max: 60 },
    { userId: id, localDate: "2026-09-28", hour: 4, avg: 56 },
  ]);
  await db.insert(sleepNights).values({
    userId: id,
    wakeDate: "2026-09-28",
    chosenSource: `Watch ${marker}`,
    bedStart: new Date("2026-09-27T22:00:00Z"),
    bedEnd: new Date("2026-09-28T06:00:00Z"),
    asleepMin: 440,
  });
  await db.insert(sleepSegments).values({
    userId: id,
    wakeDate: "2026-09-28",
    stage: "deep",
    startTs: new Date("2026-09-27T23:00:00Z"),
    endTs: new Date("2026-09-28T00:00:00Z"),
    source: `Watch ${marker}`,
  });
  await db.insert(dailyScores).values({ userId: id, localDate: "2026-09-28", recovery: 71, sleepScore: 80, strain: 9.5, components: { note: marker } });
  await db.insert(ingestEvents).values({
    userId: id,
    status: 200,
    authMethod: "bearer",
    bytes: 99,
    durationMs: 12,
    summary: { days: 2, dateRange: { from: "2026-09-27", to: "2026-09-28" } },
    body: { days: [{ date: "2026-09-28", steps: 2222, note: `body ${marker}` }] },
  });
  const [own] = await db.insert(messages).values({ groupId: g.id, userId: id, kind: "text", body: `hello ${marker}` }).returning();
  const [theirs] = await db.insert(messages).values({ groupId: g.id, userId: null, kind: "system", body: `system ${marker}` }).returning();
  await db.insert(reactions).values([
    { messageId: theirs.id, userId: id, emoji: "🔥" },
    { messageId: own.id, userId: id, emoji: "👍" },
  ]);
  await db.insert(championAwards).values({ groupId: g.id, weekStart: "2026-09-21", category: "sleep", userId: id, value: 91.5, messageId: theirs.id });
  return { user: u, group: g };
}

async function exportJson(user: { id: string }) {
  session.user = user;
  const res = await GET(new Request("http://localhost/api/me/export", { headers: { accept: "application/json" } }));
  expect(res.status).toBe(200);
  const text = await res.text();
  return { res, text, json: JSON.parse(text) as Record<string, unknown> & Record<string, Record<string, unknown>[]> };
}

describe("GET /api/me/export", () => {
  it("401s without a session", async () => {
    const res = await GET(new Request("http://localhost/api/me/export"));
    expect(res.status).toBe(401);
  });

  it("returns every section for the user and nothing from other users", async () => {
    const me = await seedUser("me@example.com", "me_user", KEY_HASH, "MINE");
    await seedUser("other@example.com", "other_user", OTHER_HASH, "THEIRS");

    const { res, text, json } = await exportJson(me.user);

    expect(res.headers.get("content-type")).toMatch(/^application\/json/);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="huddle-export-me_user-\d{4}-\d{2}-\d{2}\.json"$/);

    expect(Object.keys(json)).toEqual(["exported_at", "format_version", ...EXPORT_SECTIONS]);
    expect(json.format_version).toBe(1);
    expect(Number.isNaN(Date.parse(json.exported_at as unknown as string))).toBe(false);

    const profile = json.profile as unknown as Record<string, unknown>;
    expect(profile).toMatchObject({
      id: me.user.id,
      email: "me@example.com",
      username: "me_user",
      display_name: "Display MINE",
      timezone: "Europe/Berlin",
      dob: "1990-05-05",
      height_cm: 170,
      step_goal: 9000,
    });

    expect(json.api_keys).toHaveLength(2);
    expect(json.api_keys.map((k) => k.prefix_hint).sort()).toEqual(["gk_newkk", "gk_oldkk"]);
    const iso = (v: unknown) => new Date(v as string).toISOString();
    expect(iso(json.api_keys.find((k) => k.prefix_hint === "gk_oldkk")!.revoked_at)).toBe("2026-02-01T00:00:00.000Z");
    expect(iso(json.api_keys.find((k) => k.prefix_hint === "gk_newkk")!.last_used_at)).toBe("2026-09-28T08:00:00.000Z");

    expect(json.groups).toEqual([expect.objectContaining({ name: "Group MINE", timezone: "Europe/Berlin" })]);
    expect(json.daily_metrics.map((r) => [r.local_date, r.steps])).toEqual([
      ["2026-09-27", 1111],
      ["2026-09-28", 2222],
    ]);
    expect(json.daily_metrics[0].resting_hr).toBe(51.5);
    expect(json.hr_hourly.map((r) => r.hour)).toEqual([3, 4]);
    expect(json.sleep_nights).toHaveLength(1);
    expect(json.sleep_nights[0]).toMatchObject({ wake_date: "2026-09-28", chosen_source: "Watch MINE", asleep_min: 440 });
    expect(json.sleep_segments).toHaveLength(1);
    expect(json.sleep_segments[0]).toMatchObject({ stage: "deep", source: "Watch MINE" });
    expect(json.daily_scores[0]).toMatchObject({ local_date: "2026-09-28", recovery: 71, components: { note: "MINE" } });
    expect(json.ingest_events).toHaveLength(1);
    expect(json.ingest_events[0]).toMatchObject({
      status: 200,
      summary: { days: 2 },
      body: { days: [{ note: "body MINE" }] },
    });
    expect(json.messages.map((m) => m.body)).toEqual(["hello MINE"]);
    expect(json.reactions.map((r) => r.emoji).sort()).toEqual(["👍", "🔥"]);
    expect(json.champion_awards).toEqual([expect.objectContaining({ category: "sleep", week_start: "2026-09-21", value: 91.5 })]);

    // Nothing of the other user's, and nothing that authenticates.
    expect(text).not.toContain("THEIRS");
    expect(text).not.toContain("other@example.com");
    expect(text).not.toContain("gk_other");
    expect(text).not.toContain(KEY_HASH);
    expect(text).not.toContain(OTHER_HASH);
    for (const forbidden of ['"hash"', "session_token", "access_token", "refresh_token", "id_token", "password"]) {
      expect(text).not.toContain(forbidden);
    }
    // user_id is implied by the file, so rows don't repeat it.
    expect(text).not.toContain('"user_id"');
  });

  it("exports empty sections as empty arrays for a user with no data", async () => {
    const [u] = await db.insert(users).values({ email: "empty@example.com", username: "empty_one", onboardedAt: new Date() }).returning();
    const { json } = await exportJson(u);
    for (const key of EXPORT_SECTIONS.filter((k) => k !== "profile")) expect(json[key]).toEqual([]);
    expect((json.profile as unknown as Record<string, unknown>).username).toBe("empty_one");
  });

  it("streams the body in several chunks that concatenate to valid JSON", async () => {
    const me = await seedUser("stream@example.com", "stream_user", KEY_HASH, "S");
    // Enough hourly rows to need more than one database batch (1000 per batch).
    await db.insert(hrHourly).values(
      Array.from({ length: 2500 }, (_, i) => ({
        userId: me.user.id,
        localDate: new Date(Date.UTC(2025, 0, 1) + Math.floor(i / 24) * 86_400_000).toISOString().slice(0, 10),
        hour: i % 24,
        avg: 60 + (i % 10),
      })),
    );
    session.user = me.user;
    const res = await GET(new Request("http://localhost/api/me/export"));
    expect(res.body).toBeInstanceOf(ReadableStream);

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const parts: string[] = [];
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      parts.push(decoder.decode(value, { stream: true }));
    }
    expect(parts.length).toBeGreaterThan(EXPORT_SECTIONS.length);
    // No single chunk is the whole document.
    expect(Math.max(...parts.map((p) => p.length))).toBeLessThan(parts.join("").length);
    const json = JSON.parse(parts.join(""));
    // 2500 rows plus the two seeded ones (seeded rows are on 2026-09-28, the generated ones are in 2025).
    expect(json.hr_hourly).toHaveLength(2502);
  });

  it("stops querying when the client cancels", async () => {
    const me = await seedUser("cancel@example.com", "cancel_user", KEY_HASH, "C");
    session.user = me.user;
    const res = await GET(new Request("http://localhost/api/me/export"));
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel();
    // The connection pool still serves queries afterwards.
    expect(await db.$count(users)).toBe(1);
  });

  it("allows 5 exports an hour per user, then answers 429 (or redirects a link tap back to Profile)", async () => {
    const [a] = await db.insert(users).values({ email: "rl-a@example.com", username: "rl_a", onboardedAt: new Date() }).returning();
    const [b] = await db.insert(users).values({ email: "rl-b@example.com", username: "rl_b", onboardedAt: new Date() }).returning();
    session.user = a;
    for (let i = 0; i < 5; i++) {
      const res = await GET(new Request("http://localhost/api/me/export"));
      expect(res.status).toBe(200);
      await res.text();
    }
    const limited = await GET(new Request("http://localhost/api/me/export", { headers: { accept: "application/json" } }));
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);

    const tap = await GET(new Request("http://localhost/api/me/export", { headers: { accept: "text/html,application/xhtml+xml" } }));
    expect(tap.status).toBe(303);
    expect(tap.headers.get("location")).toBe("/profile?export=limited");

    // Another user is unaffected.
    session.user = b;
    expect((await GET(new Request("http://localhost/api/me/export"))).status).toBe(200);
  });
});

describe("exportFilename", () => {
  it("uses the username and the user's local date, and sanitizes odd names", () => {
    const now = new Date("2026-09-29T23:30:00Z");
    expect(exportFilename({ username: "alex_runs", timezone: "UTC" }, now)).toBe("huddle-export-alex_runs-2026-09-29.json");
    expect(exportFilename({ username: "alex_runs", timezone: "Asia/Tokyo" }, now)).toBe("huddle-export-alex_runs-2026-09-30.json");
    expect(exportFilename({ username: null, timezone: null }, now)).toBe("huddle-export-user-2026-09-29.json");
    expect(exportFilename({ username: 'a"b/../c', timezone: "Not/AZone" }, now)).toBe("huddle-export-a_b____c-2026-09-29.json");
  });
});
