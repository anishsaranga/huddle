import { describe, expect, it } from "vitest";
import { normalizeIngest } from "@/lib/ingest/normalize";
import { parsePayload } from "@/lib/ingest/schema";
import { collectUnknownFields } from "@/lib/ingest/summary";
import { addDays, localDateOf } from "@/lib/tz";
import {
  buildPayload,
  chunkRanges,
  DEMO_USERS,
  isoLocal,
  PROFILE_METRICS,
  simulateDay,
  simulateNight,
  type DemoUser,
  type ProfileId,
} from "../../scripts/seed/generate";
import { checkDevDatabase, checkSeedTarget, isSeedableDatabase } from "../../scripts/seed/guard";

/** Noon UTC, so it's the same calendar day (or the next) everywhere and no night is still "in the future". */
const NOW = new Date("2026-09-29T12:00:00Z");
const user = (profile: ProfileId) => DEMO_USERS.find((u) => u.profile === profile)!;

function normalized(u: DemoUser, from: string, to: string, now = NOW) {
  const body = buildPayload(u, { from, to, now });
  const parsed = parsePayload(body);
  if (!parsed.ok) throw new Error(`${u.slug}: ${JSON.stringify(parsed.issues.slice(0, 5))}`);
  const n = normalizeIngest(parsed.payload, { profileTz: u.timezone, now });
  if (!n.ok) throw new Error(`${u.slug}: ${JSON.stringify(n.issues.slice(0, 5))}`);
  return { body, parsed: parsed.payload, n: n.value };
}

describe("demo users", () => {
  it("covers every device profile and both payload formats", () => {
    expect(new Set(DEMO_USERS.map((u) => u.profile))).toEqual(new Set(["watch", "fitbit", "zepp", "iphone"]));
    expect(new Set(DEMO_USERS.map((u) => u.format))).toEqual(new Set(["columnar", "rows", "bare"]));
    expect(new Set(DEMO_USERS.map((u) => u.timezone))).toEqual(new Set(["Asia/Kolkata", "Europe/Berlin", "America/New_York"]));
    expect(DEMO_USERS).toHaveLength(6);
  });

  it("has unique emails and usernames", () => {
    expect(new Set(DEMO_USERS.map((u) => u.email)).size).toBe(DEMO_USERS.length);
    expect(new Set(DEMO_USERS.map((u) => u.username)).size).toBe(DEMO_USERS.length);
  });
});

describe("payload generators", () => {
  it.each(DEMO_USERS.map((u) => [u.slug, u] as const))("%s: 30 days validate and normalize", (_slug, u) => {
    const to = localDateOf(NOW.getTime(), u.timezone);
    const { n } = normalized(u, addDays(to, -29), to);
    expect(n.days).toHaveLength(30);
    expect(n.days[0].date).toBe(addDays(to, -29));
    // Nobody sends more sleep than nights; every night wakes on a day of the payload or just before it.
    expect(n.nights.length).toBeLessThanOrEqual(30);
    expect(n.nights.length).toBeGreaterThan(22);
  });

  it("is deterministic", () => {
    const u = user("watch");
    const a = JSON.stringify(buildPayload(u, { from: "2026-08-01", to: "2026-08-30", now: NOW }));
    const b = JSON.stringify(buildPayload(u, { from: "2026-08-01", to: "2026-08-30", now: NOW }));
    expect(a).toBe(b);
    // A day's numbers don't depend on which window it is sent in.
    const one = simulateDay(u, "2026-08-15");
    const again = simulateDay(u, "2026-08-15");
    expect(one).toEqual(again);
  });

  it("only sends the metrics each device writes", () => {
    for (const profile of ["watch", "fitbit", "zepp", "iphone"] as const) {
      const u = user(profile);
      const { n } = normalized(u, "2026-08-01", "2026-08-30");
      const sent = new Set(n.days.flatMap((d) => Object.keys(d.metrics)));
      const allowed = new Set([...PROFILE_METRICS[profile], "weight_kg", "body_fat_pct", "mindful_min"]);
      for (const name of sent) expect(allowed, `${profile} sent ${name}`).toContain(name);
      for (const name of PROFILE_METRICS[profile]) expect(sent, `${profile} never sent ${name}`).toContain(name);
    }
    const fitbit = normalized(user("fitbit"), "2026-08-01", "2026-08-30").n;
    expect(fitbit.days.some((d) => "hrv_sdnn_ms" in d.metrics)).toBe(false);
    const zepp = normalized(user("zepp"), "2026-08-01", "2026-08-30").n;
    expect(zepp.days.some((d) => "hrv_sdnn_ms" in d.metrics || "resp_rate" in d.metrics)).toBe(false);
  });

  it("writes each device's sleep sources and stages", () => {
    const stages = (p: ProfileId) => normalized(user(p), "2026-08-01", "2026-08-30").n.sleepSources;
    const watch = stages("watch");
    expect(watch["Apple Watch"]).toEqual(expect.arrayContaining(["in_bed", "core", "deep", "rem", "awake"]));
    expect(Object.keys(watch)).toEqual(expect.arrayContaining(["Apple Watch", "iPhone"]));
    expect(watch["iPhone"]).toEqual(["in_bed"]);

    const fitbit = stages("fitbit");
    expect(Object.keys(fitbit)).toEqual(["Google Health"]);
    expect(fitbit["Google Health"]).toEqual(expect.arrayContaining(["core", "deep", "rem", "awake"]));
    expect(fitbit["Google Health"]).not.toContain("in_bed");

    const zepp = stages("zepp");
    expect(Object.keys(zepp)).toEqual(["Zepp"]);
    expect([...zepp["Zepp"]].sort()).toEqual(["asleep", "awake"]);

    const phone = stages("iphone");
    expect(phone).toEqual({ iPhone: ["in_bed"] });
  });

  it("keeps sleep and vitals inside the documented ranges", () => {
    for (const u of DEMO_USERS) {
      for (let d = 0; d < 90; d++) {
        const date = addDays("2026-07-01", d);
        const m = simulateDay(u, date).metrics;
        expect(m.resting_hr!).toBeGreaterThanOrEqual(48);
        expect(m.resting_hr!).toBeLessThanOrEqual(68);
        expect(m.hrv_sdnn_ms!).toBeGreaterThanOrEqual(30);
        expect(m.hrv_sdnn_ms!).toBeLessThanOrEqual(90);
        expect(m.steps!).toBeGreaterThanOrEqual(3000);
        expect(m.steps!).toBeLessThanOrEqual(18000);

        const night = simulateNight(u, date);
        if (!night) continue;
        const clock = (ms: number) => {
          const p = new Intl.DateTimeFormat("en-GB", { timeZone: u.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(ms);
          const [h, mi] = p.split(":").map(Number);
          return h * 60 + mi;
        };
        const bed = clock(night.bedMs);
        // 22:30 to 01:00 (across midnight), wake 06:00 to 08:30.
        expect(bed >= 22 * 60 + 30 || bed <= 60, `${u.slug} ${date} bed ${bed}`).toBe(true);
        const wake = clock(night.wakeMs);
        expect(wake).toBeGreaterThanOrEqual(6 * 60);
        expect(wake).toBeLessThanOrEqual(8 * 60 + 30);
        // Stages are contiguous and inside the night.
        for (let i = 1; i < night.stages.length; i++) expect(night.stages[i].start).toBeGreaterThanOrEqual(night.stages[i - 1].end);
        expect(night.stages[0].start).toBeGreaterThanOrEqual(night.bedMs);
        expect(night.stages.at(-1)!.end).toBeLessThanOrEqual(night.wakeMs);
      }
    }
  });

  it("includes hard days, sick stretches and hourly heart rate for wearables", () => {
    const u = user("watch");
    const days = Array.from({ length: 90 }, (_, i) => simulateDay(u, addDays("2026-07-01", i)));
    expect(days.filter((d) => d.hard).length).toBeGreaterThanOrEqual(5);
    expect(days.filter((d) => d.sick).length).toBeGreaterThanOrEqual(4);
    const { n } = normalized(u, "2026-08-01", "2026-08-30");
    expect(n.days.every((d) => (d.hrHourly?.length ?? 0) >= 15)).toBe(true);
    // iPhone-only people have no hourly HR at all.
    const phone = normalized(user("iphone"), "2026-08-01", "2026-08-30").n;
    expect(phone.days.every((d) => d.hrHourly === undefined)).toBe(true);
  });

  it("sends an unknown field for at least one user", () => {
    const withUnknown = DEMO_USERS.filter((u) => u.persona.unknownField);
    expect(withUnknown.length).toBeGreaterThanOrEqual(1);
    const u = user("fitbit").persona.unknownField ? user("fitbit") : withUnknown[0];
    const found = collectUnknownFields(buildPayload(u, { from: "2026-07-01", to: "2026-08-30", now: NOW }));
    expect(Object.keys(found)).toContain(u.persona.unknownField!.name);
    expect(found[u.persona.unknownField!.name].count).toBeGreaterThan(3);
  });

  it("uses the columnar (text) and rows (number) shapes as configured", () => {
    const columnar = DEMO_USERS.find((u) => u.format === "columnar" && u.profile === "watch")!;
    const body = buildPayload(columnar, { from: "2026-08-10", to: "2026-08-12", now: NOW }) as { days: Record<string, unknown>[]; sleep_segments: Record<string, string>; tz: string };
    expect(body.tz).toBe(columnar.timezone);
    expect(typeof body.days[0].steps).toBe("string");
    expect(typeof (body.days[0].hr_hourly as Record<string, string>).avg).toBe("string");
    expect(body.sleep_segments.stages.split("\n").length).toBeGreaterThan(5);

    const rows = DEMO_USERS.find((u) => u.format === "rows")!;
    const r = buildPayload(rows, { from: "2026-08-10", to: "2026-08-12", now: NOW }) as { days: Record<string, unknown>[] };
    expect(typeof r.days[0].steps).toBe("number");
    expect(Array.isArray(r.days[0].hr_hourly)).toBe(true);

    const bare = DEMO_USERS.find((u) => u.format === "bare")!;
    const b = buildPayload(bare, { from: "2026-08-10", to: "2026-08-12", now: NOW });
    expect(Array.isArray(b)).toBe(true);
  });

  it("leaves out today's unfinished night and hours", () => {
    const u = user("watch");
    const early = new Date("2026-09-29T03:00:00Z"); // 05:00 in Berlin / 21:00 the day before in New York
    const to = localDateOf(early.getTime(), u.timezone);
    const { n } = normalized(u, addDays(to, -2), to, early);
    const today = n.days.find((d) => d.date === to)!;
    expect((today.hrHourly ?? []).every((r) => r.hour < 5)).toBe(true);
    expect(n.nights.every((night) => night.wakeDate < to || night.wakeDate === to)).toBe(true);
  });
});

describe("chunkRanges", () => {
  it("splits 90 days into three 30-day chunks, oldest first", () => {
    const chunks = chunkRanges("2026-09-29", 90, 30);
    expect(chunks).toEqual([
      { from: "2026-07-02", to: "2026-07-31" },
      { from: "2026-08-01", to: "2026-08-30" },
      { from: "2026-08-31", to: "2026-09-29" },
    ]);
  });

  it("handles a remainder", () => {
    expect(chunkRanges("2026-01-10", 10, 4)).toEqual([
      { from: "2026-01-01", to: "2026-01-04" },
      { from: "2026-01-05", to: "2026-01-08" },
      { from: "2026-01-09", to: "2026-01-10" },
    ]);
  });
});

describe("isoLocal", () => {
  it("formats with the zone's offset", () => {
    expect(isoLocal(Date.UTC(2026, 8, 28, 21, 4), "Europe/Berlin")).toBe("2026-09-28T23:04:00+02:00");
    expect(isoLocal(Date.UTC(2026, 8, 28, 21, 4), "Asia/Kolkata")).toBe("2026-09-29T02:34:00+05:30");
    expect(isoLocal(Date.UTC(2026, 0, 5, 12, 0), "America/New_York")).toBe("2026-01-05T07:00:00-05:00");
  });
});

describe("seed guard", () => {
  const good = { NODE_ENV: "development", DATABASE_URL: "postgres://u:p@127.0.0.1:5433/huddle", API_KEY_PEPPER: "x" };

  it("allows the dev and test databases", () => {
    expect(checkSeedTarget(good)).toMatchObject({ ok: true, display: "127.0.0.1:5433/huddle" });
    expect(checkSeedTarget({ ...good, DATABASE_URL: "postgres://u:p@localhost:5433/huddle_test" }).ok).toBe(true);
    expect(isSeedableDatabase("huddle")).toBe(true);
    expect(isSeedableDatabase("something_test")).toBe(true);
  });

  it("refuses production, other databases, and a missing URL or pepper", () => {
    expect(checkSeedTarget({ ...good, NODE_ENV: "production" }).ok).toBe(false);
    expect(checkSeedTarget({ ...good, DATABASE_URL: "postgres://u:p@db:5432/huddle_prod" }).ok).toBe(false);
    expect(checkSeedTarget({ ...good, DATABASE_URL: "postgres://u:p@db:5432/postgres" }).ok).toBe(false);
    expect(checkSeedTarget({ ...good, DATABASE_URL: "nonsense" }).ok).toBe(false);
    expect(checkSeedTarget({ ...good, DATABASE_URL: undefined }).ok).toBe(false);
    expect(checkSeedTarget({ ...good, API_KEY_PEPPER: undefined }).ok).toBe(false);
    expect(isSeedableDatabase("huddle2")).toBe(false);
    expect(isSeedableDatabase("test")).toBe(false);
  });

  it("the score recompute script uses the same database rules, without needing the pepper", () => {
    expect(checkDevDatabase({ NODE_ENV: good.NODE_ENV, DATABASE_URL: good.DATABASE_URL }).ok).toBe(true);
    expect(checkDevDatabase({ ...good, NODE_ENV: "production" }).ok).toBe(false);
    const r = checkDevDatabase({ ...good, DATABASE_URL: "postgres://u:p@db:5432/huddle_prod" }, "recompute scores in");
    expect(r).toEqual({ ok: false, error: expect.stringContaining("refusing to recompute scores in database \"huddle_prod\"") });
  });

  it("never echoes the password", () => {
    const r = checkSeedTarget({ ...good, DATABASE_URL: "postgres://user:secretpw@127.0.0.1:5433/huddle" });
    expect(JSON.stringify(r)).not.toContain("secretpw");
  });
});
