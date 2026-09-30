import { gzipSync } from "node:zlib";
import { and, asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { apiKeys, dailyMetrics, dailyScores, hrHourly, ingestEvents, sleepNights, sleepSegments, users } from "@/db/schema";
import type { Db } from "@/lib/admin/db";
import { createKeyForUser, revokeKeysForUser } from "@/lib/apikey";
import { MAX_BODY_BYTES } from "@/lib/ingest/body";
import { ingestDeps } from "@/lib/ingest/handler";
import type { IngestSummary } from "@/lib/ingest/types";
import { createLogger } from "@/lib/log";
import { resetIngestLimiters } from "@/lib/ratelimit";
import { addDays, todayIn } from "@/lib/tz";

const route = await import("@/app/api/ingest/route");

const TZ = "Europe/Berlin";
const URL_BASE = "http://localhost/api/ingest";
const today = () => todayIn(TZ);

/* ------------------------------------------------------------------ */
/* Log capture and dependency reset                                    */
/* ------------------------------------------------------------------ */

let logLines: string[] = [];
const original = { ...ingestDeps };

beforeEach(() => {
  resetIngestLimiters();
  logLines = [];
  ingestDeps.log = createLogger({ write: (s: string) => void logLines.push(s) }, { level: "debug" }).child({ module: "ingest" });
});

afterEach(() => {
  Object.assign(ingestDeps, original);
});

const logText = () => logLines.join("");
const logRecords = () => logLines.map((l) => JSON.parse(l) as Record<string, unknown>);

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

async function makeUser(email = "ada@example.com", extra: Partial<typeof users.$inferInsert> = {}) {
  const [u] = await db
    .insert(users)
    .values({ email, username: email.split("@")[0], timezone: TZ, onboardedAt: new Date(), ...extra })
    .returning();
  const { key } = await createKeyForUser(db, u.id);
  return { user: u, key };
}

type PostOpts = { key?: string; query?: boolean; headers?: Record<string, string>; raw?: BodyInit; method?: string };

function request(body: unknown, opts: PostOpts = {}): Request {
  const headers: Record<string, string> = { "content-type": "application/json", ...opts.headers };
  if (opts.key && !opts.query) headers.authorization = `Bearer ${opts.key}`;
  const url = opts.key && opts.query ? `${URL_BASE}?key=${opts.key}` : URL_BASE;
  const init: RequestInit & { duplex?: string } = {
    method: opts.method ?? "POST",
    headers,
    body: opts.raw ?? JSON.stringify(body),
  };
  if (opts.raw instanceof ReadableStream) init.duplex = "half";
  return new Request(url, init);
}

const post = (body: unknown, opts: PostOpts = {}) => route.POST(request(body, opts));

const eventsOf = (userId: string) =>
  db.select().from(ingestEvents).where(eq(ingestEvents.userId, userId)).orderBy(asc(ingestEvents.id));
const allEvents = () => db.select().from(ingestEvents);
const metricsOf = (userId: string) =>
  db.select().from(dailyMetrics).where(eq(dailyMetrics.userId, userId)).orderBy(asc(dailyMetrics.localDate));
const hrOf = (userId: string, date: string) =>
  db
    .select({ hour: hrHourly.hour, avg: hrHourly.avg, min: hrHourly.min, max: hrHourly.max })
    .from(hrHourly)
    .where(and(eq(hrHourly.userId, userId), eq(hrHourly.localDate, date)))
    .orderBy(asc(hrHourly.hour));

/** A stream that yields `total` bytes in 64 KB chunks (no Content-Length). */
function byteStream(total: number, fill = 0x20): ReadableStream<Uint8Array> {
  let sent = 0;
  return new ReadableStream({
    pull(c) {
      if (sent >= total) return c.close();
      const n = Math.min(65536, total - sent);
      sent += n;
      c.enqueue(new Uint8Array(n).fill(fill));
    },
  });
}

/* ------------------------------------------------------------------ */
/* Auth                                                                 */
/* ------------------------------------------------------------------ */

describe("auth", () => {
  it("accepts a Bearer key", async () => {
    const { user, key } = await makeUser();
    const res = await post({ date: today(), steps: 1234 }, { key });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body).toEqual({
      ok: true,
      days_written: 1,
      date_range: { from: today(), to: today() },
      last_sync_at: expect.any(String),
      unknown_fields: [],
    });
    const [ev] = await eventsOf(user.id);
    expect(ev).toMatchObject({ status: 200, authMethod: "bearer" });
    expect(ev.receivedAt.toISOString()).toBe(body.last_sync_at);
  });

  it("accepts ?key=, and never logs the query string", async () => {
    const { user, key } = await makeUser();
    const res = await post({ date: today(), steps: 1 }, { key, query: true });
    expect(res.status).toBe(200);
    const [ev] = await eventsOf(user.id);
    expect(ev.authMethod).toBe("query");
    expect(logText()).not.toContain(key);
    expect(logText()).not.toContain("key=");
    expect(logRecords().find((r) => r.msg === "ingest ok")).toMatchObject({ auth: "query", path: "/api/ingest" });
  });

  it("answers a bare 401 for missing, malformed, unknown, revoked and deactivated keys, and stores nothing", async () => {
    const { user, key } = await makeUser();
    const other = await makeUser("bo@example.com");
    await revokeKeysForUser(db, other.user.id);
    const deactivated = await makeUser("cy@example.com");
    await db.update(users).set({ deactivatedAt: new Date() }).where(eq(users.id, deactivated.user.id));

    const cases: [PostOpts, string][] = [
      [{}, "missing_key"],
      [{ headers: { authorization: "Bearer nope" } }, "malformed_key"],
      [{ key: "junk", query: true }, "malformed_key"],
      [{ key: `gk_${"Z".repeat(43)}` }, "invalid_key"],
      [{ key: other.key }, "invalid_key"],
      [{ key: deactivated.key, query: true }, "invalid_key"],
    ];
    for (const [opts, reason] of cases) {
      logLines = [];
      const res = await post({ date: today(), steps: 1 }, opts);
      expect(res.status).toBe(401);
      expect(await res.text()).toBe("");
      const [rec] = logRecords();
      expect(rec).toMatchObject({ reason, status: 401, level: 30 });
      expect(Object.keys(rec).sort()).toEqual(["auth_method", "ip", "level", "module", "msg", "path", "pid", "hostname", "reason", "status", "time"].sort());
    }
    expect(await allEvents()).toHaveLength(0);
    expect(await metricsOf(user.id)).toHaveLength(0);
    expect(logText()).not.toContain(other.key);
    expect(logText()).not.toContain(deactivated.key);
    expect(key).toBeTruthy();
  });

  it("405 for other methods", async () => {
    const res = route.GET();
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
  });
});

/* ------------------------------------------------------------------ */
/* Rate limiting                                                        */
/* ------------------------------------------------------------------ */

describe("rate limiting", () => {
  it("the 61st request in an hour from one key gets 429 with Retry-After, and is recorded", async () => {
    const { user, key } = await makeUser();
    for (let i = 0; i < 60; i++) {
      // Different IPs, so only the per-key limit applies.
      const res = await post({ date: today() }, { key, headers: { "cf-connecting-ip": `203.0.113.${i}` } });
      expect(res.status, `request ${i + 1}`).toBe(200);
    }
    const res = await post({ date: today() }, { key, headers: { "cf-connecting-ip": "198.51.100.1" } });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(3500);
    expect(await res.json()).toMatchObject({ error: "rate_limited" });
    const events = await eventsOf(user.id);
    expect(events).toHaveLength(61);
    expect(events.at(-1)).toMatchObject({ status: 429, errors: { reason: "key_rate_limited" }, body: null });
  });

  it("limits per IP before auth: a flood of bad keys gets 429 after 60", async () => {
    const ip = { "cf-connecting-ip": "203.0.113.9" };
    for (let i = 0; i < 60; i++) {
      const res = await post({ date: today() }, { key: `gk_${String(i).padStart(43, "x")}`, headers: ip });
      expect(res.status).toBe(401);
    }
    const flood = await post({ date: today() }, { key: `gk_${"y".repeat(43)}`, headers: ip });
    expect(flood.status).toBe(429);
    expect(flood.headers.get("retry-after")).toBeTruthy();
    expect(await allEvents()).toHaveLength(0);

    // A valid key from that IP is limited too, and the 429 is recorded for its user.
    const { user, key } = await makeUser();
    const res = await post({ date: today() }, { key, headers: ip });
    expect(res.status).toBe(429);
    expect(await eventsOf(user.id)).toMatchObject([{ status: 429, errors: { reason: "ip_rate_limited" } }]);
    // Other IPs are unaffected.
    expect((await post({ date: today() }, { key, headers: { "cf-connecting-ip": "203.0.113.10" } })).status).toBe(200);
  });
});

/* ------------------------------------------------------------------ */
/* Body handling                                                        */
/* ------------------------------------------------------------------ */

describe("body", () => {
  it("413 on a Content-Length over 3 MB, without reading the body", async () => {
    const { user, key } = await makeUser();
    const res = await post(null, { key, raw: "{}", headers: { "content-length": String(MAX_BODY_BYTES + 1) } });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "too_large", max_bytes: MAX_BODY_BYTES });
    expect(await eventsOf(user.id)).toMatchObject([{ status: 413, bytes: MAX_BODY_BYTES + 1, errors: { reason: "too_large" } }]);
  });

  it("413 when a streamed body without Content-Length passes 3 MB", async () => {
    const { user, key } = await makeUser();
    const req = request(null, { key, raw: byteStream(MAX_BODY_BYTES + 100_000) });
    expect(req.headers.get("content-length")).toBeNull();
    const res = await route.POST(req);
    expect(res.status).toBe(413);
    const [ev] = await eventsOf(user.id);
    expect(ev.status).toBe(413);
    expect(ev.bytes).toBeGreaterThan(MAX_BODY_BYTES);
    expect(ev.bytes).toBeLessThanOrEqual(MAX_BODY_BYTES + 65536);
  });

  it("accepts a body of exactly 3 MB (whitespace-padded JSON)", async () => {
    const { key } = await makeUser();
    const json = JSON.stringify({ date: today(), steps: 5 });
    const padded = json + " ".repeat(MAX_BODY_BYTES - json.length);
    expect((await post(null, { key, raw: padded })).status).toBe(200);
  });

  it("accepts gzip", async () => {
    const { user, key } = await makeUser();
    const payload = { days: [{ date: today(), steps: 4321 }] };
    const res = await post(null, { key, raw: gzipSync(JSON.stringify(payload)), headers: { "content-encoding": "gzip" } });
    expect(res.status).toBe(200);
    const [row] = await metricsOf(user.id);
    expect(row.steps).toBe(4321);
    const [ev] = await eventsOf(user.id);
    expect(ev.summary).toMatchObject({ gzip: true, decodedBytes: JSON.stringify(payload).length });
    expect(ev.body).toEqual(payload);
  });

  it("413 for a gzip bomb (small compressed, over 3 MB decompressed)", async () => {
    const { user, key } = await makeUser();
    const bomb = gzipSync(Buffer.alloc(MAX_BODY_BYTES * 4, 0x20));
    expect(bomb.length).toBeLessThan(100_000);
    const res = await post(null, { key, raw: bomb, headers: { "content-encoding": "gzip" } });
    expect(res.status).toBe(413);
    expect(await eventsOf(user.id)).toMatchObject([{ status: 413, errors: { reason: "decompressed_too_large" } }]);
  });

  it("400 for invalid gzip, 415 for other encodings", async () => {
    const { user, key } = await makeUser();
    const bad = await post(null, { key, raw: "not gzip", headers: { "content-encoding": "gzip" } });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "invalid_gzip" });
    const br = await post({ date: today() }, { key, headers: { "content-encoding": "br" } });
    expect(br.status).toBe(415);
    expect((await eventsOf(user.id)).map((e) => e.status)).toEqual([400, 415]);
  });

  it("400 for invalid JSON; the raw text prefix is kept for debugging", async () => {
    const { user, key } = await makeUser();
    const res = await post(null, { key, raw: '{"date": "2026-09-28", steps: 5' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_json" });
    const [ev] = await eventsOf(user.id);
    expect(ev).toMatchObject({ status: 400, errors: { reason: "invalid_json" }, body: '{"date": "2026-09-28", steps: 5' });
    expect((await post(null, { key, raw: "" })).status).toBe(400);
    expect((await post(null, { key, raw: new Uint8Array([0x7b, 0xff, 0x7d]) })).status).toBe(400);
  });
});

/* ------------------------------------------------------------------ */
/* Validation                                                           */
/* ------------------------------------------------------------------ */

describe("validation", () => {
  it("400 for a date after today+1 (user's timezone), listing it; the event keeps the body", async () => {
    const { user, key } = await makeUser();
    const future = addDays(today(), 2);
    const res = await post({ days: [{ date: today(), steps: 1 }, { date: future, steps: 2 }] }, { key });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("validation");
    expect(body.issues[0].message).toContain(future);
    expect(await metricsOf(user.id)).toHaveLength(0);
    const [ev] = await eventsOf(user.id);
    expect(ev).toMatchObject({ status: 400, errors: { reason: "validation" } });
    expect((ev.summary as IngestSummary).days).toBe(2);
    expect(ev.body).toEqual({ days: [{ date: today(), steps: 1 }, { date: future, steps: 2 }] });
    // today+1 is fine.
    expect((await post({ date: addDays(today(), 1) }, { key })).status).toBe(200);
  });

  it("400 with trimmed zod issues for bad values", async () => {
    const { key } = await makeUser();
    const res = await post([{ date: today(), steps: "lots", resting_hr: 5 }], { key });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "validation",
      issues: [
        { path: [0, "steps"], message: 'expected a number, got "lots"' },
        { path: [0, "resting_hr"], message: "out of range: 5 (allowed 20-200 bpm)" },
      ],
    });
    const many = Array.from({ length: 80 }, () => ({ date: "nope" }));
    expect((await (await post(many, { key })).json()).issues).toHaveLength(50);
  });
});

/* ------------------------------------------------------------------ */
/* Upsert semantics                                                     */
/* ------------------------------------------------------------------ */

describe("upsert", () => {
  it("the same payload twice makes one row; the second counts as updated", async () => {
    const { user, key } = await makeUser();
    const payload = { date: today(), steps: "7,412", resting_hr: "51.5", spo2_pct: 0.97 };
    expect((await post(payload, { key })).status).toBe(200);
    expect((await post(payload, { key })).status).toBe(200);
    const rows = await metricsOf(user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ steps: 7412, resting_hr: 51.5 });
    expect(rows[0].spo2_pct).toBeCloseTo(97);
    const [first, second] = await eventsOf(user.id);
    expect(first.summary).toMatchObject({ rowsInserted: 1, rowsUpdated: 0 });
    expect(second.summary).toMatchObject({ rowsInserted: 0, rowsUpdated: 1 });
    expect(rows[0].updatedAt.getTime()).toBeGreaterThanOrEqual(rows[0].createdAt.getTime());
  });

  it("absent keys are untouched, explicit null clears", async () => {
    const { user, key } = await makeUser();
    const d = today();
    await post({ date: d, steps: 100, resting_hr: 50, vo2max: 45 }, { key });
    await post({ date: d, steps: 200 }, { key });
    let [row] = await metricsOf(user.id);
    expect(row).toMatchObject({ steps: 200, resting_hr: 50, vo2max: 45 });
    await post({ date: d, resting_hr: null, vo2max: "" }, { key });
    [row] = await metricsOf(user.id);
    expect(row).toMatchObject({ steps: 200, resting_hr: null, vo2max: null });
    const ev = (await eventsOf(user.id)).at(-1)!;
    expect((ev.summary as IngestSummary).fields!.perDay[d]).toMatchObject({ present: [], nulls: ["resting_hr", "vo2max"] });
  });

  it("days with different key sets in one request", async () => {
    const { user, key } = await makeUser();
    const [d1, d2, d3] = [addDays(today(), -2), addDays(today(), -1), today()];
    await post({ days: [{ date: d1, steps: 1 }, { date: d2, steps: 2, flights: 3 }, { date: d3 }] }, { key });
    const rows = await metricsOf(user.id);
    expect(rows.map((r) => [r.localDate, r.steps, r.flights])).toEqual([
      [d1, 1, null],
      [d2, 2, 3],
      [d3, null, null],
    ]);
  });

  it("hr_hourly: present replaces the day's rows, absent leaves them, [] clears", async () => {
    const { user, key } = await makeUser();
    const d = today();
    await post({ date: d, hr_hourly: { hours: "0\n1\n2", avg: "50\n51\n52", max: "60\n61\n62" } }, { key });
    expect(await hrOf(user.id, d)).toEqual([
      { hour: 0, avg: 50, min: null, max: 60 },
      { hour: 1, avg: 51, min: null, max: 61 },
      { hour: 2, avg: 52, min: null, max: 62 },
    ]);
    await post({ date: d, hr_hourly: [{ hour: 5, avg: 70, min: 60, max: 90 }] }, { key });
    expect(await hrOf(user.id, d)).toEqual([{ hour: 5, avg: 70, min: 60, max: 90 }]);
    await post({ date: d, steps: 1 }, { key });
    expect(await hrOf(user.id, d)).toHaveLength(1);
    await post({ date: d, hr_hourly: [] }, { key });
    expect(await hrOf(user.id, d)).toHaveLength(0);
  });

  it("sleep: a resent night replaces its segments and is recomputed", async () => {
    const { user, key } = await makeUser();
    const wake = today();
    const prev = addDays(wake, -1);
    const at = (date: string, hm: string) => `${date}T${hm}:00+02:00`;
    const first = {
      days: [{ date: wake }],
      sleep_segments: {
        stages: "Core\nDeep\nREM",
        starts: [at(prev, "23:00"), at(wake, "01:00"), at(wake, "02:00")].join("\n"),
        ends: [at(wake, "01:00"), at(wake, "02:00"), at(wake, "03:00")].join("\n"),
        sources: "Apple Watch\nApple Watch\nApple Watch",
      },
      tz: TZ,
    };
    await post(first, { key });
    let [night] = await db.select().from(sleepNights).where(eq(sleepNights.userId, user.id));
    expect(night).toMatchObject({ wakeDate: wake, chosenSource: "Apple Watch", asleepMin: 240, coreMin: 120, hasStages: true });

    // The full night arrives later: more segments, plus the iPhone's in_bed.
    const second = {
      days: [{ date: wake }],
      sleep_segments: [
        { stage: "In Bed", start: at(prev, "22:30"), end: at(wake, "07:00"), source: "iPhone" },
        { stage: "Core", start: at(prev, "23:00"), end: at(wake, "01:00"), source: "Apple Watch" },
        { stage: "Deep", start: at(wake, "01:00"), end: at(wake, "02:00"), source: "Apple Watch" },
        { stage: "REM", start: at(wake, "02:00"), end: at(wake, "03:00"), source: "Apple Watch" },
        { stage: "Core", start: at(wake, "03:00"), end: at(wake, "06:30"), source: "Apple Watch" },
      ],
      tz: TZ,
    };
    await post(second, { key });
    [night] = await db.select().from(sleepNights).where(eq(sleepNights.userId, user.id));
    expect(night).toMatchObject({ wakeDate: wake, asleepMin: 450, coreMin: 330, inBedMin: 510, awakeMin: 60 });
    expect(night.bedStart.toISOString()).toBe(new Date(at(prev, "22:30")).toISOString());
    const segs = await db.select().from(sleepSegments).where(eq(sleepSegments.userId, user.id));
    expect(segs).toHaveLength(5);
    expect(new Set(segs.map((s) => s.wakeDate))).toEqual(new Set([wake]));
    const ev = (await eventsOf(user.id)).at(-1)!;
    expect(ev.summary).toMatchObject({
      sleepSegmentCount: 5,
      nights: [wake],
      nightsWritten: 1,
      sleepSources: { iPhone: ["in_bed"], "Apple Watch": ["core", "deep", "rem"] },
    });
  });

  it("sleep: a night first seen half-finished (assigned to the previous date) moves to its real wake date", async () => {
    const { user, key } = await makeUser();
    const wake = today();
    const prev = addDays(wake, -1);
    const at = (date: string, hm: string) => `${date}T${hm}:00+02:00`;
    // Synced at 23:55: the session so far ends on `prev`.
    await post({ days: [{ date: prev }], sleep_segments: [{ stage: "Asleep", start: at(prev, "22:00"), end: at(prev, "23:50"), source: "Zepp" }], tz: TZ }, { key });
    expect((await db.select().from(sleepNights).where(eq(sleepNights.userId, user.id))).map((n) => n.wakeDate)).toEqual([prev]);
    // Next morning: the whole night, now ending on `wake`.
    await post({ days: [{ date: wake }], sleep_segments: [{ stage: "Asleep", start: at(prev, "22:00"), end: at(wake, "06:00"), source: "Zepp" }], tz: TZ }, { key });
    const nights = await db.select().from(sleepNights).where(eq(sleepNights.userId, user.id));
    expect(nights.map((n) => [n.wakeDate, n.asleepMin])).toEqual([[wake, 480]]);
    const segs = await db.select().from(sleepSegments).where(eq(sleepSegments.userId, user.id));
    expect(segs.map((s) => s.wakeDate)).toEqual([wake]);
    expect((await eventsOf(user.id)).at(-1)!.summary).toMatchObject({ nightsRecomputed: [prev] });
  });

  it("a 366-day backfill with everything is fast; 367 days is rejected", async () => {
    const { user, key } = await makeUser();
    const days = Array.from({ length: 366 }, (_, i) => {
      const date = addDays(today(), -365 + i);
      const prev = addDays(date, -1);
      return {
        date,
        steps: 8000 + i,
        distance_m: "6,123.5",
        flights: 10,
        active_kcal: 500.5,
        resting_kcal: 1600,
        exercise_min: 30,
        stand_min: 600,
        daylight_min: 45,
        mindful_min: 5,
        resting_hr: 52,
        walking_hr_avg: 95,
        hrv_sdnn_ms: 45,
        vo2max: 42,
        spo2_pct: 0.97,
        resp_rate: 14.5,
        wrist_temp_c: 36.1,
        weight_kg: 70,
        body_fat_pct: 18,
        hr_hourly: {
          hours: Array.from({ length: 24 }, (_, h) => h).join("\n"),
          avg: Array.from({ length: 24 }, (_, h) => 55 + h).join("\n"),
          min: Array.from({ length: 24 }, (_, h) => 50 + h).join("\n"),
          max: Array.from({ length: 24 }, (_, h) => 70 + h).join("\n"),
        },
        sleep_segments: [
          { stage: "Core", start: `${prev}T23:00:00+02:00`, end: `${date}T01:00:00+02:00`, source: "Watch" },
          { stage: "Deep", start: `${date}T01:00:00+02:00`, end: `${date}T02:00:00+02:00`, source: "Watch" },
          { stage: "REM", start: `${date}T02:00:00+02:00`, end: `${date}T03:00:00+02:00`, source: "Watch" },
          { stage: "Awake", start: `${date}T03:00:00+02:00`, end: `${date}T03:10:00+02:00`, source: "Watch" },
          { stage: "Core", start: `${date}T03:10:00+02:00`, end: `${date}T06:30:00+02:00`, source: "Watch" },
          { stage: "In Bed", start: `${prev}T22:45:00+02:00`, end: `${date}T06:45:00+02:00`, source: "iPhone" },
        ],
      };
    });
    const started = performance.now();
    const res = await post({ days, tz: TZ }, { key });
    const elapsed = performance.now() - started;
    expect(res.status).toBe(200);
    expect((await res.json()).days_written).toBe(366);
    // 10 s only guards against a pathological regression while staying green under parallel load;
    // PERF_STRICT=1 restores the real 3 s budget (run it on an otherwise idle machine).
    expect(elapsed).toBeLessThan(process.env.PERF_STRICT === "1" ? 3000 : 10_000);
    console.info(`366-day backfill: ${Math.round(elapsed)} ms`);

    expect(await metricsOf(user.id)).toHaveLength(366);
    expect(await db.$count(hrHourly, eq(hrHourly.userId, user.id))).toBe(366 * 24);
    expect(await db.$count(sleepNights, eq(sleepNights.userId, user.id))).toBe(366);
    const [ev] = await eventsOf(user.id);
    expect(ev.summary).toMatchObject({ days: 366, rowsInserted: 366, hrHourlyCount: 366 * 24, nightsWritten: 366 });

    // Again, as updates.
    const again = await post({ days, tz: TZ }, { key });
    expect(again.status).toBe(200);
    expect((await eventsOf(user.id)).at(-1)!.summary).toMatchObject({ rowsInserted: 0, rowsUpdated: 366 });

    const tooMany = [...days, { date: today() }];
    const rejected = await post({ days: tooMany }, { key });
    expect(rejected.status).toBe(400);
    expect((await rejected.json()).issues[0].message).toMatch(/at most 366 days/);
    // Whole test (two big requests + score recompute) needs headroom beyond the 5 s default under load.
  }, 30_000);
});

/* ------------------------------------------------------------------ */
/* Unknown fields, audit trail, logging                                 */
/* ------------------------------------------------------------------ */

describe("unknown fields and the audit trail", () => {
  it("records unknown fields in the summary and response, keeps them in the stored body, never in metrics", async () => {
    const { user, key } = await makeUser();
    const payload = { days: [{ date: today(), steps: 10, cycling_km: 12.5 }], shortcut_version: "1.0" };
    const res = await post(payload, { key });
    expect(res.status).toBe(200);
    expect((await res.json()).unknown_fields).toEqual(["cycling_km", "top.shortcut_version"]);
    const [ev] = await eventsOf(user.id);
    expect((ev.summary as IngestSummary).unknownFields).toEqual({
      cycling_km: { count: 1, types: ["number"] },
      "top.shortcut_version": { count: 1, types: ["string"] },
    });
    expect(ev.body).toEqual(payload);
    const [row] = await metricsOf(user.id);
    expect(Object.keys(row)).not.toContain("cycling_km");
  });

  it("never stores or logs the key, even when a Shortcut puts it in the body", async () => {
    const { user, key } = await makeUser();
    const res = await post({ key, api_key: key, days: [{ date: today(), note: `key=${key}` }] }, { key });
    expect(res.status).toBe(200);
    const [ev] = await eventsOf(user.id);
    expect(JSON.stringify(ev)).not.toContain(key.slice(3));
    expect(ev.body).toMatchObject({ key: "[REDACTED]", api_key: "[REDACTED]", days: [{ note: "key=[REDACTED]" }] });
    expect(logText()).not.toContain(key.slice(3));
    // The debug line with the body is there, scrubbed.
    expect(logRecords().some((r) => r.msg === "ingest body")).toBe(true);
  });

  it("an event per authenticated request, with the right status", async () => {
    const { user, key } = await makeUser();
    await post({ date: today() }, { key }); // 200
    await post({ date: "bad" }, { key }); // 400
    await post(null, { key, raw: "{" }); // 400
    await post(null, { key, raw: "{}", headers: { "content-length": String(MAX_BODY_BYTES * 2) } }); // 413
    await post({ date: today() }, { key: `gk_${"Q".repeat(43)}` }); // 401: not recorded
    const events = await eventsOf(user.id);
    expect(events.map((e) => e.status)).toEqual([200, 400, 400, 413]);
    expect(events.every((e) => e.authMethod === "bearer" && e.durationMs >= 0)).toBe(true);
    expect(events[0].bytes).toBe(JSON.stringify({ date: today() }).length);
  });

  it("logs one info line per request with userId and the field inventory, and never the key or header", async () => {
    const { user, key } = await makeUser();
    await post(
      { days: [{ date: today(), steps: 5, resting_hr: null, hr_hourly: [{ hour: 1, avg: 50 }] }], mystery: 1 },
      { key, headers: { "x-forwarded-for": "198.51.100.23, 10.0.0.1" } },
    );
    const info = logRecords().filter((r) => r.level === 30);
    expect(info).toHaveLength(1);
    expect(info[0]).toMatchObject({
      msg: "ingest ok",
      module: "ingest",
      userId: user.id,
      username: "ada",
      auth: "bearer",
      ip: "198.51.100.23",
      status: 200,
      days: 1,
      dateRange: { from: today(), to: today() },
      fieldTotals: { steps: { present: 1, nulls: 0 }, resting_hr: { present: 0, nulls: 1 } },
      unknownFields: { "top.mystery": { count: 1, types: ["number"] } },
      hrHourlyCount: 1,
      sleepSegmentCount: 0,
      rowsInserted: 1,
      rowsUpdated: 0,
    });
    expect(typeof info[0].durationMs).toBe("number");
    expect(typeof info[0].bytes).toBe("number");
    const text = logText();
    expect(text).not.toContain(key);
    expect(text).not.toContain(key.slice(3, 20));
    expect(text).not.toContain("Bearer");
    expect(text).not.toContain("key=");

    // Rejections log the issues.
    logLines = [];
    await post({ date: today(), steps: -1 }, { key });
    expect(logRecords().find((r) => r.level === 30)).toMatchObject({ status: 400, reason: "validation", issues: [{ path: ["steps"] }] });
  });
});

/* ------------------------------------------------------------------ */
/* Failures and the scores hook                                         */
/* ------------------------------------------------------------------ */

describe("failures and hooks", () => {
  it("calls onDataIngested with the affected dates; a throwing hook doesn't fail the request", async () => {
    const { user, key } = await makeUser();
    const calls: [string, readonly string[]][] = [];
    ingestDeps.onDataIngested = (userId, dates) => {
      calls.push([userId, dates]);
      throw new Error("scores exploded");
    };
    const d = today();
    const res = await post(
      { days: [{ date: d, steps: 1 }], sleep_segments: [{ stage: "Asleep", start: `${addDays(d, -3)}T23:00:00+02:00`, end: `${addDays(d, -2)}T06:00:00+02:00` }], tz: TZ },
      { key },
    );
    expect(res.status).toBe(200);
    expect(calls).toEqual([[user.id, [addDays(d, -2), d]]]);
    expect(logRecords().some((r) => r.level === 50 && String(r.msg).includes("onDataIngested"))).toBe(true);
  });

  it("a failing upsert rolls back, answers 500, and is still recorded", async () => {
    const { user, key } = await makeUser();
    const realDb = ingestDeps.db;
    ingestDeps.db = new Proxy(realDb, {
      get(target, prop, receiver) {
        if (prop === "transaction") {
          return (fn: (tx: unknown) => Promise<unknown>) =>
            target.transaction(async (tx) => {
              await fn(tx);
              throw new Error("disk full");
            });
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as Db;
    const res = await post({ date: today(), steps: 99 }, { key });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal" });
    expect(await metricsOf(user.id)).toHaveLength(0);
    const [ev] = await eventsOf(user.id);
    expect(ev).toMatchObject({ status: 500, errors: { reason: "upsert_failed", detail: "disk full" } });
    expect((ev.summary as IngestSummary).days).toBe(1);
  });

  it("key rows stay intact (sanity: last_used_at is bumped by ingest auth)", async () => {
    const { user, key } = await makeUser();
    await post({ date: today() }, { key });
    const [k] = await db.select().from(apiKeys).where(eq(apiKeys.userId, user.id));
    expect(k.lastUsedAt).not.toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Series shape                                                         */
/* ------------------------------------------------------------------ */

describe("series shape", () => {
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  /** A date as Shortcuts renders a Date in text: `Sep 28, 2026 at 12:00 AM` (narrow no-break space before AM/PM). */
  const en = (date: string, time = "12:00 AM") => {
    const [y, m, d] = date.split("-").map(Number);
    return `${MONTHS[m - 1]} ${d}, ${y} at ${time}`;
  };
  const col = (xs: (string | number)[]) => xs.join("\n");
  const scoresOf = (userId: string) =>
    db.select().from(dailyScores).where(eq(dailyScores.userId, userId)).orderBy(asc(dailyScores.localDate));
  const pick = (rows: Awaited<ReturnType<typeof metricsOf>>) =>
    rows.map((r) => ({ d: r.localDate, steps: r.steps, kcal: r.active_kcal, rhr: r.resting_hr, hrv: r.hrv_sdnn_ms, vo2: r.vo2max }));

  /** What a Shortcut builds from one grouped "Find Health Samples" per metric over the last days. */
  function shortcutPayload(t: string) {
    const [d0, d1, d2, d3] = [addDays(t, -4), addDays(t, -3), addDays(t, -2), addDays(t, -1)];
    return {
      window: { from: d1, to: t },
      series: {
        // The rolling query's first group (d0) is a partial day, outside the window.
        steps: { starts: col([d0, d1, d2, d3, t].map((d) => en(d))), values: col([300, 7412, 9020, 8311, 2104]) + "\n" },
        // No active energy on d2 (e.g. the watch was charging): d2 becomes null.
        active_kcal: { starts: col([d1, d3].map((d) => en(d))), values: col(["412.5", "388"]) },
        resting_hr: { starts: col([d1, d2, d3].map((d) => en(d))), values: col([52, 53, 51]) },
        // Sent but empty: Health had no HRV at all in the window.
        hrv_sdnn_ms: { starts: "", values: "" },
        cycling_km: { starts: en(d1), values: "12" },
      },
      hr: {
        starts: col([en(d3, "11:00 PM"), en(t), en(t, "1:00 AM")]),
        avg: col([58, 55, 54]),
        min: col([52, 50, 49]),
        max: col([66, 61, 60]),
      },
      sleep_segments: {
        stages: col(["In Bed", "Core", "Deep", "REM", "Awake"]),
        starts: col([en(d3, "10:51 PM"), en(d3, "11:04 PM"), en(t, "12:31 AM"), en(t, "1:12 AM"), en(t, "6:40 AM")]),
        ends: col([en(t, "6:58 AM"), en(t, "12:31 AM"), en(t, "1:12 AM"), en(t, "2:03 AM"), en(t, "6:52 AM")]),
        sources: col(["Ada’s iPhone", "Apple Watch", "Apple Watch", "Apple Watch", "Apple Watch"]),
      },
      meta: { shortcut_version: "1", device: "iPhone 15" },
    };
  }

  it("pivots a Shortcut's 3-day series into days: explicit nulls for past dates, today untouched; idempotent; scores computed", async () => {
    const { user, key } = await makeUser();
    const t = today();
    const [d1, d2, d3] = [addDays(t, -3), addDays(t, -2), addDays(t, -1)];
    // Earlier syncs: values the series must clear (d2 active energy, HRV) or leave alone (today, vo2max).
    await post({ days: [{ date: d2, active_kcal: 999, hrv_sdnn_ms: 60, vo2max: 40 }, { date: t, active_kcal: 150, resting_hr: 55, hrv_sdnn_ms: 61 }] }, { key });

    const payload = shortcutPayload(t);
    const res = await post(payload, { key });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, days_written: 4, date_range: { from: d1, to: t }, unknown_fields: ["cycling_km"] });

    const expected = [
      { d: d1, steps: 7412, kcal: 412.5, rhr: 52, hrv: null, vo2: null },
      { d: d2, steps: 9020, kcal: null, rhr: 53, hrv: null, vo2: 40 },
      { d: d3, steps: 8311, kcal: 388, rhr: 51, hrv: null, vo2: null },
      { d: t, steps: 2104, kcal: 150, rhr: 55, hrv: 61, vo2: null },
    ];
    expect(pick(await metricsOf(user.id))).toEqual(expected);
    expect((await hrOf(user.id, d3)).map((r) => r.hour)).toEqual([23]);
    expect(await hrOf(user.id, t)).toEqual([
      { hour: 0, avg: 55, min: 50, max: 61 },
      { hour: 1, avg: 54, min: 49, max: 60 },
    ]);
    const [night] = await db.select().from(sleepNights).where(eq(sleepNights.userId, user.id));
    expect(night).toMatchObject({ wakeDate: t, chosenSource: "Apple Watch", hasStages: true });

    const ev = (await eventsOf(user.id)).at(-1)!;
    expect(ev.summary).toMatchObject({
      shape: "series",
      meta: { shortcut_version: "1", device: "iPhone 15" },
      window: { from: d1, to: t },
      days: 4,
      tzAdjustments: 0,
      nullFilled: { active_kcal: 1, hrv_sdnn_ms: 3 },
      outsideWindow: { steps: 1 },
      unknownFields: { cycling_km: { count: 1, types: ["object"] } },
      hrHourlyDays: 2,
      nights: [t],
      rowsInserted: 2,
      rowsUpdated: 2,
    });
    expect(logRecords().find((r) => r.msg === "ingest ok" && r.shape === "series")).toMatchObject({
      nullFilled: { active_kcal: 1, hrv_sdnn_ms: 3 },
      meta: { device: "iPhone 15" },
    });

    // Scores were recomputed for the affected dates.
    const scores = await scoresOf(user.id);
    expect(scores.map((s) => s.localDate)).toEqual(expect.arrayContaining([d1, d2, d3, t]));
    expect(scores.find((s) => s.localDate === t)!.sleepScore).not.toBeNull();

    // Re-sending the same snapshot changes nothing.
    const before = { metrics: pick(await metricsOf(user.id)), hr: await hrOf(user.id, t), scores: scores.map((s) => [s.localDate, s.sleepScore, s.recovery, s.strain]) };
    expect((await post(payload, { key })).status).toBe(200);
    expect(pick(await metricsOf(user.id))).toEqual(before.metrics);
    expect(await hrOf(user.id, t)).toEqual(before.hr);
    expect((await scoresOf(user.id)).map((s) => [s.localDate, s.sleepScore, s.recovery, s.strain])).toEqual(before.scores);
    expect((await eventsOf(user.id)).at(-1)!.summary).toMatchObject({ rowsInserted: 0, rowsUpdated: 4 });
  });

  it("400s a column mismatch naming the series, stores nothing, and records the shape", async () => {
    const { user, key } = await makeUser();
    const t = today();
    const res = await post(
      { window: { from: addDays(t, -2), to: t }, series: { steps: { starts: col([en(addDays(t, -1)), en(t)]), values: "100" } } },
      { key },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.issues).toEqual([
      { path: ["series", "steps"], message: 'series "steps": starts and values need the same number of lines (starts: 2, values: 1)' },
    ]);
    expect(await metricsOf(user.id)).toHaveLength(0);
    const [ev] = await eventsOf(user.id);
    expect(ev).toMatchObject({ status: 400, summary: { shape: "series", days: 3, dateRange: { from: addDays(t, -2), to: t } } });
  });
});
