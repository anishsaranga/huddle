import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { dailyMetrics, hrHourly, ingestEvents, sleepNights, users } from "@/db/schema";
import type { Db } from "@/lib/admin/db";
import {
  getCoverage,
  getIngestEventBody,
  getIngestEventDetail,
  getIngestLog,
  getIngestOverview,
  getSleepSources,
  getUnknownFields,
} from "@/lib/admin/data";
import { COVERAGE_COLUMNS } from "@/lib/admin/coverage-columns";
import { createKeyForUser } from "@/lib/apikey";
import { ingestDeps } from "@/lib/ingest/handler";
import type { IngestSummary } from "@/lib/ingest/types";
import { createLogger } from "@/lib/log";
import { resetIngestLimiters } from "@/lib/ratelimit";
import { addDays } from "@/lib/tz";
import { TEST_DATABASE_URL } from "../support/test-db";

// The only thing stubbed: who is signed in. requireAdmin mirrors the real one (404 for everyone but the admin).
const session = vi.hoisted(() => ({ user: null as null | { id: string; isAdmin: boolean } }));
vi.mock("@/lib/session", () => ({
  getCurrentUser: async () => session.user,
  requireAdmin: async () => {
    if (!session.user?.isAdmin) throw new Error("NEXT_HTTP_ERROR_FALLBACK;404");
    return session.user;
  },
}));

const actions = await import("@/app/admin/data/actions");
const route = await import("@/app/api/ingest/route");

beforeEach(() => {
  session.user = null;
});

const NOW = new Date("2026-09-29T12:00:00Z");

async function makeUser(email: string, extra: Partial<typeof users.$inferInsert> = {}) {
  const [u] = await db
    .insert(users)
    .values({ email, displayName: email.split("@")[0], onboardedAt: new Date(), ...extra })
    .returning();
  return u;
}

const base = { bytes: 100, durationMs: 5, authMethod: "bearer" } as const;

/* ------------------------------------------------------------------ */
/* Coverage                                                            */
/* ------------------------------------------------------------------ */

describe("getCoverage", () => {
  it("computes each cell as the share of the last 30 local days with a value", async () => {
    const ada = await makeUser("ada@example.com", { timezone: "Asia/Kolkata" });
    // "Today" for Ada at NOW is 2026-09-29, so her window is 2026-08-31 .. 2026-09-29.
    const inWindow = (i: number) => addDays("2026-09-29", -i); // i = 0..29
    const rows: (typeof dailyMetrics.$inferInsert)[] = [];
    for (let i = 0; i < 30; i++) {
      rows.push({
        userId: ada.id,
        localDate: inWindow(i),
        steps: i < 15 ? 8000 : null, // 15 of 30 -> 50%
        resting_hr: 52, // all 30 -> 100%
        hrv_sdnn_ms: null, // 0%
        spo2_pct: i % 3 === 0 ? 97 : null, // 10 of 30 -> 33%
      });
    }
    // Outside the window: must not count.
    rows.push({ userId: ada.id, localDate: addDays("2026-09-29", -30), steps: 1, hrv_sdnn_ms: 50 });
    rows.push({ userId: ada.id, localDate: addDays("2026-09-29", -45), steps: 1 });
    await db.insert(dailyMetrics).values(rows);

    // Hourly HR on 6 distinct days (several hours each), sleep nights on 24 days, 12 with stages.
    const hr: (typeof hrHourly.$inferInsert)[] = [];
    for (let i = 0; i < 6; i++) for (const hour of [1, 2, 3, 9, 14]) hr.push({ userId: ada.id, localDate: inWindow(i), hour, avg: 60 });
    hr.push({ userId: ada.id, localDate: addDays("2026-09-29", -40), hour: 5, avg: 60 }); // outside
    await db.insert(hrHourly).values(hr);
    const nights: (typeof sleepNights.$inferInsert)[] = [];
    for (let i = 0; i < 24; i++) {
      nights.push({
        userId: ada.id,
        wakeDate: inWindow(i),
        chosenSource: "Apple Watch",
        bedStart: new Date("2026-01-01T22:00:00Z"),
        bedEnd: new Date("2026-01-02T06:00:00Z"),
        hasStages: i < 12,
      });
    }
    await db.insert(sleepNights).values(nights);

    const cov = await getCoverage(db, { now: NOW });
    expect(cov.windowDays).toBe(30);
    const row = cov.users.find((u) => u.id === ada.id)!;
    expect(row.window).toEqual({ from: "2026-08-31", to: "2026-09-29" });
    expect(row.cells.steps).toEqual({ days: 15, pct: 50 });
    expect(row.cells.resting_hr).toEqual({ days: 30, pct: 100 });
    expect(row.cells.hrv_sdnn_ms).toEqual({ days: 0, pct: 0 });
    expect(row.cells.spo2_pct).toEqual({ days: 10, pct: 33 });
    expect(row.cells.vo2max).toEqual({ days: 0, pct: 0 });
    expect(row.cells.hr_hourly).toEqual({ days: 6, pct: 20 });
    expect(row.cells.sleep).toEqual({ days: 24, pct: 80 });
    expect(row.cells.sleep_stages).toEqual({ days: 12, pct: 40 });
    // Every column has a cell.
    expect(Object.keys(row.cells).sort()).toEqual(COVERAGE_COLUMNS.map((c) => c.key).sort());
  });

  it("uses each user's own timezone for 'today'", async () => {
    // At 12:00Z it is already Sep 30 in Kiritimati (UTC+14) and still Sep 29 in UTC.
    const kiri = await makeUser("kiri@example.com", { timezone: "Pacific/Kiritimati" });
    const utc = await makeUser("utc@example.com", { timezone: null });
    const badTz = await makeUser("bad@example.com", { timezone: "Not/AZone" });
    for (const u of [kiri, utc, badTz]) {
      await db.insert(dailyMetrics).values([
        { userId: u.id, localDate: "2026-09-30", steps: 1 },
        { userId: u.id, localDate: "2026-09-29", steps: 1 },
        { userId: u.id, localDate: "2026-09-01", steps: 1 },
        { userId: u.id, localDate: "2026-08-31", steps: 1 },
      ]);
    }
    const cov = await getCoverage(db, { now: NOW });
    const by = (id: string) => cov.users.find((u) => u.id === id)!;
    // Kiritimati window: Sep 1 .. Sep 30 -> Sep 30, Sep 29, Sep 1 count.
    expect(by(kiri.id).window).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(by(kiri.id).cells.steps.days).toBe(3);
    // UTC window: Aug 31 .. Sep 29 -> Sep 29, Sep 1, Aug 31 count.
    expect(by(utc.id).cells.steps.days).toBe(3);
    // An invalid stored timezone falls back to UTC instead of failing the whole grid.
    expect(by(badTz.id).window.to).toBe("2026-09-29");
  });

  it("lists every active user (even without data), skips deactivated ones, and never runs a query per user", async () => {
    const users6: Awaited<ReturnType<typeof makeUser>>[] = [];
    for (let i = 0; i < 6; i++) users6.push(await makeUser(`u${i}@example.com`, { timezone: "Europe/Berlin" }));
    await makeUser("gone@example.com", { deactivatedAt: new Date() });
    await db.insert(dailyMetrics).values({ userId: users6[0].id, localDate: "2026-09-28", steps: 5 });

    let queries = 0;
    const client = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
    try {
      const counted = drizzle(client, { schema, logger: { logQuery: () => void queries++ } }) as unknown as Db;
      const cov = await getCoverage(counted, { now: NOW });
      expect(cov.users.map((u) => u.label).sort()).toEqual(users6.map((u) => u.displayName).sort());
      expect(cov.users.find((u) => u.id === users6[0].id)!.cells.steps.days).toBe(1);
      expect(cov.users.find((u) => u.id === users6[1].id)!.cells.steps.days).toBe(0);
    } finally {
      await client.end();
    }
    expect(queries).toBeLessThanOrEqual(3);
  });

  it("returns no rows when there are no users", async () => {
    expect((await getCoverage(db, { now: NOW })).users).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Unknown fields and sleep sources                                     */
/* ------------------------------------------------------------------ */

const at = (iso: string) => new Date(iso);

describe("getUnknownFields", () => {
  it("aggregates counts, types, users and first/last seen over the last 90 days", async () => {
    const ada = await makeUser("ada@example.com");
    const bo = await makeUser("bo@example.com");
    const ev = (userId: string, receivedAt: Date, unknownFields: IngestSummary["unknownFields"], status = 200) => ({
      ...base,
      userId,
      receivedAt,
      status,
      summary: { days: 1, dateRange: null, unknownFields } satisfies IngestSummary,
    });
    await db.insert(ingestEvents).values([
      ev(ada.id, at("2026-09-01T08:00:00Z"), { cycling_km: { count: 3, types: ["number"] } }),
      ev(ada.id, at("2026-09-20T08:00:00Z"), { cycling_km: { count: 4, types: ["number", "string"] }, "top.device": { count: 1, types: ["string"] } }),
      ev(bo.id, at("2026-09-10T08:00:00Z"), { cycling_km: { count: 10, types: ["null"] } }, 400),
      ev(bo.id, at("2026-08-15T08:00:00Z"), { walking_steadiness: { count: 2, types: ["string"] } }),
      // Older than 90 days: ignored.
      ev(bo.id, at("2026-05-01T08:00:00Z"), { ancient: { count: 99, types: ["string"] } }),
      // No unknown fields at all: ignored.
      ev(bo.id, at("2026-09-11T08:00:00Z"), {}),
      { ...base, userId: bo.id, receivedAt: at("2026-09-12T08:00:00Z"), status: 200, summary: { days: 1, dateRange: null } as IngestSummary },
      { ...base, userId: bo.id, receivedAt: at("2026-09-13T08:00:00Z"), status: 200, summary: null },
    ]);

    const rows = await getUnknownFields(db, { now: NOW });
    expect(rows.map((r) => r.name)).toEqual(["cycling_km", "walking_steadiness", "top.device"]);
    const cycling = rows[0];
    expect(cycling.total).toBe(17);
    expect(cycling.requests).toBe(3);
    expect(cycling.types).toEqual(["null", "number", "string"]);
    expect(cycling.users.map((u) => u.label)).toEqual(["ada", "bo"]);
    expect(cycling.firstSeen).toEqual(at("2026-09-01T08:00:00Z"));
    expect(cycling.lastSeen).toEqual(at("2026-09-20T08:00:00Z"));
    expect(rows.find((r) => r.name === "ancient")).toBeUndefined();
  });

  it("is empty when nothing unknown was sent", async () => {
    expect(await getUnknownFields(db, { now: NOW })).toEqual([]);
  });

  it("sees what the real ingest pipeline records (end to end)", async () => {
    const u = await makeUser("piped@example.com", { timezone: "Europe/Berlin", username: "piped" });
    const { key } = await createKeyForUser(db, u.id);
    resetIngestLimiters();
    const original = { ...ingestDeps };
    ingestDeps.log = createLogger({ write: () => {} }, { level: "silent" }).child({ module: "ingest" });
    try {
      const res = await route.POST(
        new Request("http://localhost/api/ingest", {
          method: "POST",
          headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
          body: JSON.stringify({
            tz: "Europe/Berlin",
            days: [
              { date: "2026-09-27", steps: 100, cycling_km: 12.5 },
              { date: "2026-09-28", steps: 200, cycling_km: "30" },
            ],
            sleep_segments: [
              { stage: "Core", start: "2026-09-27T23:00:00+02:00", end: "2026-09-28T01:00:00+02:00", source: "Apple Watch" },
              { stage: "In Bed", start: "2026-09-27T22:50:00+02:00", end: "2026-09-28T06:00:00+02:00", source: "iPhone" },
            ],
          }),
        }),
      );
      expect(res.status).toBe(200);
    } finally {
      Object.assign(ingestDeps, original);
    }
    const [row] = await getUnknownFields(db, { now: new Date() });
    expect(row).toMatchObject({ name: "cycling_km", total: 2, types: ["number", "string"] });
    const sources = await getSleepSources(db, { now: new Date() });
    expect(sources).toHaveLength(1);
    expect(sources[0].sources.map((s) => [s.name, s.stages])).toEqual(
      expect.arrayContaining([
        ["Apple Watch", ["core"]],
        ["iPhone", ["in_bed"]],
      ]),
    );
  });
});

describe("getSleepSources", () => {
  it("lists each user's sources with the union of stages they wrote and the nights they won", async () => {
    const ada = await makeUser("ada@example.com");
    const bo = await makeUser("bo@example.com");
    const ev = (userId: string, receivedAt: Date, sleepSources: IngestSummary["sleepSources"]) => ({
      ...base,
      userId,
      receivedAt,
      status: 200,
      summary: { days: 1, dateRange: null, sleepSources } satisfies IngestSummary,
    });
    await db.insert(ingestEvents).values([
      ev(ada.id, at("2026-09-20T08:00:00Z"), { "Apple Watch": ["core", "deep"], iPhone: ["in_bed"] }),
      ev(ada.id, at("2026-09-25T08:00:00Z"), { "Apple Watch": ["rem", "awake", "core"], iPhone: ["in_bed"] }),
      ev(bo.id, at("2026-09-25T08:00:00Z"), { Zepp: ["asleep", "awake"] }),
      ev(bo.id, at("2026-03-01T08:00:00Z"), { Fitbit: ["core"] }), // too old
    ]);
    const night = (userId: string, wakeDate: string, chosenSource: string) => ({
      userId,
      wakeDate,
      chosenSource,
      bedStart: new Date("2026-01-01T22:00:00Z"),
      bedEnd: new Date("2026-01-02T06:00:00Z"),
    });
    await db.insert(sleepNights).values([
      night(ada.id, "2026-09-20", "Apple Watch"),
      night(ada.id, "2026-09-21", "Apple Watch"),
      night(ada.id, "2026-09-22", "iPhone"),
      night(bo.id, "2026-09-21", "Zepp"),
    ]);

    const rows = await getSleepSources(db, { now: NOW });
    expect(rows.map((r) => r.user.label)).toEqual(["ada", "bo"]);
    const [adaRow, boRow] = rows;
    expect(adaRow.sources.map((s) => s.name)).toEqual(["Apple Watch", "iPhone"]);
    expect(adaRow.sources[0]).toMatchObject({ stages: ["awake", "core", "deep", "rem"], requests: 2, nightsChosen: 2 });
    expect(adaRow.sources[1]).toMatchObject({ stages: ["in_bed"], nightsChosen: 1 });
    expect(boRow.sources).toHaveLength(1);
    expect(boRow.sources[0]).toMatchObject({ name: "Zepp", stages: ["asleep", "awake"], nightsChosen: 1 });
  });
});

/* ------------------------------------------------------------------ */
/* Ingest log                                                           */
/* ------------------------------------------------------------------ */

describe("getIngestLog", () => {
  async function seedEvents(userId: string, n: number) {
    const rows: (typeof ingestEvents.$inferInsert)[] = [];
    for (let i = 0; i < n; i++) {
      rows.push({
        ...base,
        userId,
        receivedAt: new Date(Date.UTC(2026, 8, 1, 0, i)), // i = 0 is the oldest
        status: i % 5 === 4 ? 400 : i % 11 === 10 ? 429 : 200,
        summary: {
          days: 3,
          dateRange: { from: "2026-08-30", to: "2026-09-01" },
          fields: { perDay: { "2026-09-01": { present: ["steps"], nulls: [], absent: ["hrv_sdnn_ms"] } }, totals: {} },
          rowsInserted: i,
        } as IngestSummary,
      });
    }
    await db.insert(ingestEvents).values(rows);
  }

  it("paginates 25 per page, newest first", async () => {
    const ada = await makeUser("ada@example.com");
    const bo = await makeUser("bo@example.com");
    await seedEvents(ada.id, 60);
    await seedEvents(bo.id, 3);

    const p1 = await getIngestLog(db, { userId: ada.id });
    expect(p1).toMatchObject({ total: 60, page: 1, pageCount: 3, pageSize: 25 });
    expect(p1!.rows).toHaveLength(25);
    expect(p1!.rows[0].summary?.rowsInserted).toBe(59);
    expect(p1!.rows[24].summary?.rowsInserted).toBe(35);

    const p3 = await getIngestLog(db, { userId: ada.id, page: 3 });
    expect(p3!.rows).toHaveLength(10);
    expect(p3!.rows.at(-1)!.summary?.rowsInserted).toBe(0);

    // Out-of-range pages are clamped; junk falls back to page 1.
    expect((await getIngestLog(db, { userId: ada.id, page: 99 }))!.page).toBe(3);
    expect((await getIngestLog(db, { userId: ada.id, page: -4 }))!.page).toBe(1);
    expect((await getIngestLog(db, { userId: ada.id, page: Number.NaN }))!.page).toBe(1);

    // Only this user's events.
    expect((await getIngestLog(db, { userId: bo.id }))!.total).toBe(3);
    // The heavy per-day inventory is not in the list payload.
    expect(p1!.rows[0].summary).not.toHaveProperty("fields");
    expect(p1!.rows[0].summary).toMatchObject({ days: 3, dateRange: { from: "2026-08-30", to: "2026-09-01" } });
  });

  it("filters by status", async () => {
    const ada = await makeUser("ada@example.com");
    await seedEvents(ada.id, 60);
    const ok = await getIngestLog(db, { userId: ada.id, filter: "ok" });
    const errors = await getIngestLog(db, { userId: ada.id, filter: "errors" });
    const all = await getIngestLog(db, { userId: ada.id, filter: "all" });
    expect(ok!.total + errors!.total).toBe(all!.total);
    expect(ok!.rows.every((r) => r.status === 200)).toBe(true);
    expect(errors!.rows.every((r) => r.status !== 200)).toBe(true);
    expect(errors!.total).toBeGreaterThan(10);
    expect(errors!.rows.some((r) => r.status === 429)).toBe(true);
    // Pagination follows the filter.
    expect(ok!.pageCount).toBe(Math.ceil(ok!.total / 25));
  });

  it("returns null for an unknown user and an empty page for a user with no events", async () => {
    expect(await getIngestLog(db, { userId: "00000000-0000-4000-8000-000000000000" })).toBeNull();
    const ada = await makeUser("ada@example.com");
    expect(await getIngestLog(db, { userId: ada.id })).toMatchObject({ total: 0, rows: [], page: 1, pageCount: 1 });
  });

  it("rolls up events and failures per user", async () => {
    const ada = await makeUser("ada@example.com");
    await makeUser("quiet@example.com");
    await seedEvents(ada.id, 12);
    const rows = await getIngestOverview(db);
    const adaRow = rows.find((r) => r.user.id === ada.id)!;
    expect(adaRow.events).toBe(12);
    expect(adaRow.errors).toBeGreaterThan(0);
    expect(adaRow.lastAt).toEqual(new Date(Date.UTC(2026, 8, 1, 0, 11)));
    expect(rows.find((r) => r.user.label === "quiet")).toMatchObject({ events: 0, errors: 0, lastAt: null });
  });
});

describe("event detail and body", () => {
  async function makeEvent(userId: string, body: unknown, summary?: IngestSummary | null) {
    const [e] = await db
      .insert(ingestEvents)
      .values({ ...base, userId, status: 200, receivedAt: NOW, summary: summary ?? null, body })
      .returning({ id: ingestEvents.id });
    return e.id;
  }

  it("loads the per-day field inventory on demand", async () => {
    const ada = await makeUser("ada@example.com");
    const inv = { perDay: { "2026-09-28": { present: ["steps"], nulls: ["hrv_sdnn_ms"], absent: ["vo2max"] } }, totals: {} };
    const id = await makeEvent(ada.id, { date: "2026-09-28" }, { days: 1, dateRange: null, fields: inv });
    expect(await getIngestEventDetail(db, id)).toEqual({ id, userId: ada.id, fields: inv });
    const bare = await makeEvent(ada.id, null, null);
    expect(await getIngestEventDetail(db, bare)).toMatchObject({ fields: null });
    expect(await getIngestEventDetail(db, 999_999)).toBeNull();
  });

  it("pretty-prints a small body, cuts a big one, and handles text and missing bodies", async () => {
    const ada = await makeUser("ada@example.com");
    const small = await makeEvent(ada.id, { date: "2026-09-28", steps: 5 });
    const s = await getIngestEventBody(db, small);
    expect(s).toMatchObject({ truncated: false, isJson: true });
    expect(s!.text).toBe(JSON.stringify({ date: "2026-09-28", steps: 5 }, null, 2));
    expect(s!.totalBytes).toBeGreaterThan(10);

    const big = await makeEvent(ada.id, { days: Array.from({ length: 400 }, (_, i) => ({ date: `d${i}`, steps: i })) });
    const b = await getIngestEventBody(db, big, 1000);
    expect(b).toMatchObject({ truncated: true, isJson: false });
    expect(b!.text.length).toBe(1000);
    expect(b!.text.startsWith('{"days": [{"date": "d0"')).toBe(true);
    expect(b!.totalBytes).toBeGreaterThan(1000);

    // A body that wasn't JSON is stored as text.
    const text = await makeEvent(ada.id, '{"days": [{"date": "2026-');
    expect(await getIngestEventBody(db, text)).toMatchObject({ text: '{"days": [{"date": "2026-', truncated: false, isJson: false });

    const none = await makeEvent(ada.id, null);
    // JSON null and SQL NULL are both "nothing to show".
    const n = await getIngestEventBody(db, none);
    expect(n!.text === "" || n!.text === "null").toBe(true);
    expect(await getIngestEventBody(db, 999_999)).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Authorization                                                        */
/* ------------------------------------------------------------------ */

describe("admin only", () => {
  it("the lazy-load actions 404 for signed-out users and non-admins, and work for the admin", async () => {
    const admin = await makeUser("boss@example.com", { isAdmin: true });
    const plain = await makeUser("plain@example.com");
    const id = (
      await db
        .insert(ingestEvents)
        .values({ ...base, userId: plain.id, status: 200, receivedAt: NOW, summary: { days: 0, dateRange: null }, body: { secret: "raw body" } })
        .returning({ id: ingestEvents.id })
    )[0].id;

    session.user = null;
    await expect(actions.getIngestEventBodyAction(id)).rejects.toThrow(/404/);
    await expect(actions.getIngestEventDetailAction(id)).rejects.toThrow(/404/);

    session.user = { id: plain.id, isAdmin: false };
    await expect(actions.getIngestEventBodyAction(id)).rejects.toThrow(/404/);
    await expect(actions.getIngestEventDetailAction(id)).rejects.toThrow(/404/);

    session.user = { id: admin.id, isAdmin: true };
    const body = await actions.getIngestEventBodyAction(id);
    expect(body).toMatchObject({ ok: true });
    expect(body.ok && body.body.text).toContain("raw body");
    expect(await actions.getIngestEventDetailAction(id)).toMatchObject({ ok: true, detail: { id, userId: plain.id } });
  });

  it("rejects malformed and unknown ids for the admin without touching the database", async () => {
    const admin = await makeUser("boss@example.com", { isAdmin: true });
    session.user = { id: admin.id, isAdmin: true };
    for (const bad of [0, -1, 1.5, Number.NaN, "7" as unknown as number, null as unknown as number]) {
      expect(await actions.getIngestEventBodyAction(bad)).toMatchObject({ ok: false });
      expect(await actions.getIngestEventDetailAction(bad)).toMatchObject({ ok: false });
    }
    expect(await actions.getIngestEventBodyAction(424242)).toMatchObject({ ok: false, error: expect.stringContaining("no longer exists") });
  });
});
