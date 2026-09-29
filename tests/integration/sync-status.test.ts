import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { dailyMetrics, ingestEvents, users } from "@/db/schema";
import type { IngestSummary } from "@/lib/ingest/types";

// The route's session check is the only thing stubbed; key auth hits the real DB.
const session = vi.hoisted(() => ({ user: null as null | { id: string } }));
vi.mock("@/lib/session", () => ({ getCurrentUser: async () => session.user }));

const { GET } = await import("@/app/api/me/sync-status/route");
const { createKeyForUser, revokeKeysForUser } = await import("@/lib/apikey");
const { getSyncSummaries } = await import("@/lib/sync-status");

beforeEach(() => {
  session.user = null;
});

async function makeUser(email: string) {
  const [u] = await db.insert(users).values({ email, onboardedAt: new Date() }).returning();
  return u;
}

const summary = (from: string, to: string): IngestSummary => ({ days: 3, dateRange: { from, to } });

async function seed(userId: string) {
  await db.insert(dailyMetrics).values([
    { userId, localDate: "2026-09-20", steps: 8000 },
    { userId, localDate: "2026-09-25", steps: 9000, resting_hr: 52.5 },
    { userId, localDate: "2026-09-28", steps: null },
  ]);
  const base = { userId, bytes: 100, durationMs: 5 } as const;
  await db.insert(ingestEvents).values([
    { ...base, receivedAt: new Date("2026-09-27T08:00:00Z"), status: 200, authMethod: "bearer", summary: summary("2026-09-25", "2026-09-27") },
    { ...base, receivedAt: new Date("2026-09-28T08:00:00Z"), status: 200, authMethod: "query", summary: summary("2026-09-26", "2026-09-28") },
    // Later failures don't count as syncs.
    { ...base, receivedAt: new Date("2026-09-29T08:00:00Z"), status: 400, authMethod: "bearer", errors: { reason: "invalid" } },
    { ...base, receivedAt: new Date("2026-09-29T09:00:00Z"), status: 429, authMethod: "bearer" },
  ]);
}

function get(query = "", headers: Record<string, string> = {}) {
  return GET(new Request(`http://localhost/api/me/sync-status${query}`, { headers }));
}

const EXPECTED = {
  last_sync_at: "2026-09-28T08:00:00.000Z",
  days_covered: 3,
  first_date: "2026-09-20",
  last_date: "2026-09-28",
  last_payload_dates: { from: "2026-09-26", to: "2026-09-28" },
  // The newest request of any status: the 429 (no recorded errors, so no message).
  last_attempt: { at: "2026-09-29T09:00:00.000Z", status: 429, shape: null },
  server_time: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
};

describe("getSyncSummaries", () => {
  it("summarizes many users at once, counting successful syncs only", async () => {
    const a = await makeUser("a@example.com");
    const b = await makeUser("b@example.com");
    const onlyFailed = await makeUser("c@example.com");
    await seed(a.id);
    await db.insert(dailyMetrics).values({ userId: b.id, localDate: "2026-09-29", steps: 1 });
    await db.insert(ingestEvents).values({ userId: onlyFailed.id, status: 400, authMethod: "bearer", bytes: 1, durationMs: 1 });

    const s = await getSyncSummaries(db, [a.id, b.id, onlyFailed.id]);
    expect(s.get(a.id)).toEqual({
      lastSyncAt: new Date("2026-09-28T08:00:00Z"),
      daysCovered: 3,
      firstDate: "2026-09-20",
      lastDate: "2026-09-28",
    });
    expect(s.get(b.id)).toEqual({ lastSyncAt: null, daysCovered: 1, firstDate: "2026-09-29", lastDate: "2026-09-29" });
    expect(s.get(onlyFailed.id)).toEqual({ lastSyncAt: null, daysCovered: 0, firstDate: null, lastDate: null });
    expect((await getSyncSummaries(db, [])).size).toBe(0);
  });
});

describe("GET /api/me/sync-status", () => {
  it("works with a Bearer key", async () => {
    const u = await makeUser("k@example.com");
    await seed(u.id);
    const { key } = await createKeyForUser(db, u.id);
    const res = await get("", { authorization: `Bearer ${key}` });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual(EXPECTED);
  });

  it("works with ?key=", async () => {
    const u = await makeUser("q@example.com");
    await seed(u.id);
    const { key } = await createKeyForUser(db, u.id);
    const res = await get(`?key=${key}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(EXPECTED);
  });

  it("works with a session, and reports never-synced users", async () => {
    const u = await makeUser("s@example.com");
    session.user = u;
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body).toEqual({
      last_sync_at: null,
      days_covered: 0,
      first_date: null,
      last_date: null,
      last_payload_dates: null,
      last_attempt: null,
      server_time: expect.any(String),
    });
    expect(Math.abs(Date.parse(body.server_time) - Date.now())).toBeLessThan(10_000);
  });

  it("answers a bare 401 for bad, revoked or missing credentials", async () => {
    const u = await makeUser("r@example.com");
    const { key } = await createKeyForUser(db, u.id);
    await revokeKeysForUser(db, u.id);

    for (const res of [
      await get("", { authorization: `Bearer gk_${"Z".repeat(43)}` }),
      await get("", { authorization: "Bearer nope" }),
      await get("?key=junk"),
      await get("", { authorization: `Bearer ${key}` }),
      await get(),
    ]) {
      expect(res.status).toBe(401);
      expect(await res.text()).toBe("");
    }

    // An invalid key is refused even alongside a valid session.
    session.user = u;
    const res = await get("?key=junk");
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("");
  });
});

const ingestRoute = await import("@/app/api/ingest/route");
const { ingestDeps } = await import("@/lib/ingest/handler");
const { createLogger } = await import("@/lib/log");
const { resetIngestLimiters } = await import("@/lib/ratelimit");
const { todayIn } = await import("@/lib/tz");

describe("last_attempt", () => {
  beforeEach(() => {
    resetIngestLimiters();
    ingestDeps.log = createLogger({ write: () => {} }, { level: "silent" }).child({ module: "ingest" });
  });

  const post = (key: string, body: unknown) =>
    ingestRoute.POST(
      new Request("http://localhost/api/ingest", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
    );

  async function status(key: string) {
    const res = await get("", { authorization: `Bearer ${key}` });
    expect(res.status).toBe(200);
    return (await res.json()) as Record<string, unknown> & { last_attempt: Record<string, unknown> | null; server_time: string };
  }

  it("is null before any request, then reports a 200 with its shape and no error", async () => {
    const u = await makeUser("la-ok@example.com");
    const { key } = await createKeyForUser(db, u.id);
    expect((await status(key)).last_attempt).toBeNull();

    const today = todayIn("UTC");
    const res = await post(key, { window: { from: today, to: today }, series: { steps: { starts: today, values: "4200" } } });
    expect(res.status).toBe(200);

    const s = await status(key);
    expect(s.last_attempt).toEqual({ at: s.last_sync_at, status: 200, shape: "series" });
    expect(Date.parse(s.server_time)).toBeGreaterThanOrEqual(Date.parse(s.last_attempt!.at as string));
  });

  it("reports a 400 with the first issue (payload strings redacted), after an earlier success", async () => {
    const u = await makeUser("la-400@example.com");
    const { key } = await createKeyForUser(db, u.id);
    const today = todayIn("UTC");
    expect((await post(key, { date: today, steps: 100 })).status).toBe(200);
    const res = await post(key, { series: { steps: { starts: today, values: "lots of steps" } } });
    expect(res.status).toBe(400);

    const s = await status(key);
    expect(s.last_sync_at).not.toBeNull();
    expect(s.last_attempt).toMatchObject({ status: 400, shape: "series" });
    expect(s.last_attempt!.error).toBe('series.steps.values[0]: expected a number, got "…"');
    expect(JSON.stringify(s)).not.toContain("lots of steps");
    expect(Date.parse(s.last_attempt!.at as string)).toBeGreaterThan(Date.parse(s.last_sync_at as string));
  });

  it("reports the error code when there are no validation issues", async () => {
    const u = await makeUser("la-json@example.com");
    const { key } = await createKeyForUser(db, u.id);
    const res = await post(key, "{ not json");
    expect(res.status).toBe(400);
    const s = await status(key);
    expect(s.last_attempt).toMatchObject({ status: 400, error: "invalid_json", shape: null });
    expect(s.last_sync_at).toBeNull();
  });
});
