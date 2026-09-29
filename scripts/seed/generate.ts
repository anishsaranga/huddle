/**
 * Demo data for `npm run db:seed`: pure generators (no DB, no clock except
 * the `now` you pass) that turn a demo person and a date range into ingest
 * payloads exactly as the iPhone Shortcut would send them.
 *
 * Everything is a function of (person, local date), through a seeded PRNG, so
 * reruns produce identical numbers for the same dates. Physiology is a small
 * model: a resting HR / HRV baseline with slow drift and noise, weekend late
 * nights, ~1 in 8 hard-training days (high afternoon HR, tougher next night),
 * and a few sick / poor-recovery stretches (RHR up, HRV down, more sleep).
 *
 * Device profiles decide WHAT is sent, mirroring what each device really
 * writes to Apple Health (see the spec section "What your friends' devices
 * actually write to Apple Health"):
 *   watch   Apple Watch: everything, incl. HRV, SpO2, resp rate, wrist temp; stages from "Apple Watch"
 *   fitbit  Google Health: activity, HR, SpO2, resp rate; light/deep/rem/awake; no HRV
 *   zepp    Zepp / Amazfit: steps, active kcal, HR, SpO2; sleep only "asleep" + "awake"
 *   iphone  phone only: steps, distance, flights, active kcal; sleep only "in bed"
 */

import { seededRng, type Rng } from "@/lib/avatar/config";
import { addDays, daysBetween, localDateOf, localParts, tzOffsetMs, zonedTimeToUtc } from "@/lib/tz";

export type ProfileId = "watch" | "fitbit" | "zepp" | "iphone";
/**
 * How the payload is written:
 * - columnar: object form, numbers as text, newline-joined columns (what a Shortcut's "Combine Text" builds)
 * - rows:     object form, numbers as numbers, arrays of row objects
 * - bare:     a bare array of Days (no `tz`; the profile timezone applies), rows with `start` timestamps
 */
export type PayloadFormat = "columnar" | "rows" | "bare";

export type Persona = {
  /** Baselines. */
  rhr: number;
  hrv: number;
  steps: number;
  vo2max: number;
  /** Minutes later (+) or earlier (-) than the typical schedule. */
  chrono: number;
  /** Offsets that place the sick / poor-recovery stretches (days). */
  sickOffset: number;
  poorOffset: number;
  /** Hour of day the hard workout happens. */
  workoutHour: number;
  /** Sends weight (and, with `bodyFat`, body fat) from a smart scale. */
  scale?: { bodyFat: boolean };
  /** A key Huddle doesn't know, sent on a share of days. */
  unknownField?: { name: string; chance: number; kind: "km" | "label" };
};

export type DemoUser = {
  slug: string;
  email: string;
  displayName: string;
  username: string;
  timezone: string;
  profile: ProfileId;
  format: PayloadFormat;
  dob: string;
  sex: "male" | "female" | "other";
  heightCm: number;
  weightKg: number;
  maxHr: number;
  stepGoal: number;
  sleepGoalMin: number;
  units: "metric" | "imperial";
  persona: Persona;
};

export const DEMO_EMAIL_DOMAIN = "demo.huddle.test";

export const DEMO_USERS: readonly DemoUser[] = [
  {
    slug: "priya",
    email: `priya@${DEMO_EMAIL_DOMAIN}`,
    displayName: "Priya Nair",
    username: "priya",
    timezone: "Asia/Kolkata",
    profile: "zepp",
    format: "columnar",
    dob: "1995-04-18",
    sex: "female",
    heightCm: 163,
    weightKg: 58,
    maxHr: 188,
    stepGoal: 9000,
    sleepGoalMin: 450,
    units: "metric",
    persona: { rhr: 61, hrv: 52, steps: 8600, vo2max: 38, chrono: 20, sickOffset: 9, poorOffset: 4, workoutHour: 18, scale: { bodyFat: false } },
  },
  {
    slug: "lukas",
    email: `lukas@${DEMO_EMAIL_DOMAIN}`,
    displayName: "Lukas Weber",
    username: "lukas",
    timezone: "Europe/Berlin",
    profile: "watch",
    format: "rows",
    dob: "1991-11-02",
    sex: "male",
    heightCm: 182,
    weightKg: 79,
    maxHr: 190,
    stepGoal: 11000,
    sleepGoalMin: 465,
    units: "metric",
    persona: { rhr: 52, hrv: 68, steps: 10800, vo2max: 49, chrono: -15, sickOffset: 27, poorOffset: 11, workoutHour: 17, scale: { bodyFat: true } },
  },
  {
    slug: "maya",
    email: `maya@${DEMO_EMAIL_DOMAIN}`,
    displayName: "Maya Chen",
    username: "maya",
    timezone: "America/New_York",
    profile: "watch",
    format: "columnar",
    dob: "1998-07-23",
    sex: "female",
    heightCm: 168,
    weightKg: 61,
    maxHr: 195,
    stepGoal: 10000,
    sleepGoalMin: 480,
    units: "imperial",
    persona: {
      rhr: 57,
      hrv: 55,
      steps: 9800,
      vo2max: 43,
      chrono: 35,
      sickOffset: 18,
      poorOffset: 2,
      workoutHour: 16,
      unknownField: { name: "walking_steadiness", chance: 0.5, kind: "label" },
    },
  },
  {
    slug: "arjun",
    email: `arjun@${DEMO_EMAIL_DOMAIN}`,
    displayName: "Arjun Rao",
    username: "arjun",
    timezone: "Asia/Kolkata",
    profile: "fitbit",
    format: "bare",
    dob: "1993-01-30",
    sex: "male",
    heightCm: 176,
    weightKg: 74,
    maxHr: 192,
    stepGoal: 12000,
    sleepGoalMin: 450,
    units: "metric",
    persona: {
      rhr: 60,
      hrv: 46,
      steps: 11500,
      vo2max: 45,
      chrono: 5,
      sickOffset: 33,
      poorOffset: 16,
      workoutHour: 17,
      unknownField: { name: "cycling_km", chance: 0.25, kind: "km" },
    },
  },
  {
    slug: "sofia",
    email: `sofia@${DEMO_EMAIL_DOMAIN}`,
    displayName: "Sofia Rossi",
    username: "sofia",
    timezone: "Europe/Berlin",
    profile: "iphone",
    format: "columnar",
    dob: "2000-09-09",
    sex: "female",
    heightCm: 170,
    weightKg: 63,
    maxHr: 194,
    stepGoal: 8000,
    sleepGoalMin: 480,
    units: "metric",
    persona: { rhr: 64, hrv: 50, steps: 6800, vo2max: 36, chrono: 40, sickOffset: 5, poorOffset: 21, workoutHour: 18 },
  },
  {
    slug: "jamal",
    email: `jamal@${DEMO_EMAIL_DOMAIN}`,
    displayName: "Jamal Carter",
    username: "jamal",
    timezone: "America/New_York",
    profile: "fitbit",
    format: "rows",
    dob: "1989-05-14",
    sex: "male",
    heightCm: 188,
    weightKg: 88,
    maxHr: 186,
    stepGoal: 10000,
    sleepGoalMin: 420,
    units: "imperial",
    persona: { rhr: 55, hrv: 58, steps: 9200, vo2max: 46, chrono: -5, sickOffset: 14, poorOffset: 8, workoutHour: 7 },
  },
];

export const PROFILE_LABELS: Record<ProfileId, string> = {
  watch: "Apple Watch",
  fitbit: "Fitbit (Google Health)",
  zepp: "Zepp / Amazfit",
  iphone: "iPhone only",
};

/** Daily metrics each device profile sends (before scale extras and nulls). */
export const PROFILE_METRICS: Record<ProfileId, readonly string[]> = {
  watch: [
    "steps", "distance_m", "flights", "active_kcal", "resting_kcal", "exercise_min", "stand_min", "daylight_min",
    "resting_hr", "walking_hr_avg", "hrv_sdnn_ms", "vo2max", "spo2_pct", "resp_rate", "wrist_temp_c",
  ],
  fitbit: ["steps", "distance_m", "active_kcal", "resting_hr", "spo2_pct", "resp_rate"],
  zepp: ["steps", "active_kcal", "resting_hr", "spo2_pct"],
  iphone: ["steps", "distance_m", "flights", "active_kcal"],
};

const HAS_HR_HOURLY: Record<ProfileId, boolean> = { watch: true, fitbit: true, zepp: true, iphone: false };

/* ------------------------------------------------------------------------ */
/* Small helpers                                                             */
/* ------------------------------------------------------------------------ */

const MIN = 60_000;

const rngFor = (u: DemoUser, date: string, tag: string): Rng => seededRng(`${u.email}|${date}|${tag}`);

/** Standard normal from a uniform source (Box-Muller). */
function gauss(rng: Rng): number {
  return Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = (v: number, d = 0) => {
  const f = 10 ** d;
  return Math.round(v * f) / f;
};
const between = (rng: Rng, lo: number, hi: number) => lo + (hi - lo) * rng();

/** Days since 1970-01-01 (a stable index for cycles). */
const epochDay = (date: string) => daysBetween("1970-01-01", date);
/** 0 = Sunday. */
const dowOf = (date: string) => (epochDay(date) + 4) % 7;

/** Instant at `minutes` after local midnight of `date` (negative = the evening before). */
export function wallToMs(date: string, minutes: number, tz: string): number {
  const shift = Math.floor(minutes / 1440);
  const m = minutes - shift * 1440;
  const [y, mo, d] = addDays(date, shift).split("-").map(Number);
  return zonedTimeToUtc(y, mo, d, Math.floor(m / 60), Math.round(m % 60), 0, 0, tz);
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** ISO 8601 with the zone's offset, e.g. `2026-09-28T23:04:00+02:00` (what the Shortcut's date format produces). */
export function isoLocal(ms: number, tz: string): string {
  const p = localParts(ms, tz);
  const off = Math.round(tzOffsetMs(ms, tz) / MIN);
  const sign = off < 0 ? "-" : "+";
  const a = Math.abs(off);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

/* ------------------------------------------------------------------------ */
/* Day model                                                                 */
/* ------------------------------------------------------------------------ */

const sickOn = (u: DemoUser, date: string) => (epochDay(date) + u.persona.sickOffset) % 41 < 4;
const poorOn = (u: DemoUser, date: string) => !sickOn(u, date) && (epochDay(date) + u.persona.poorOffset) % 29 < 2;
const hardOn = (u: DemoUser, date: string) => !sickOn(u, date) && rngFor(u, date, "hard")() < 0.13;

export type Stage = "in_bed" | "asleep" | "awake" | "core" | "deep" | "rem";
export type Seg = { stage: Stage; start: number; end: number };

export type Night = {
  wakeDate: string;
  bedMs: number;
  wakeMs: number;
  sleepStartMs: number;
  sleepEndMs: number;
  /** Core / deep / rem / awake, contiguous from sleepStart to sleepEnd. */
  stages: Seg[];
};

/** The night that ends on the morning of `wakeDate` (null: nothing tracked that night). */
export function simulateNight(u: DemoUser, wakeDate: string): Night | null {
  const rng = rngFor(u, wakeDate, "night");
  const untracked = { watch: 0.04, fitbit: 0.05, zepp: 0.08, iphone: 0.03 }[u.profile];
  if (rng() < untracked) return null;

  const tz = u.timezone;
  const dow = dowOf(wakeDate);
  const weekend = dow === 6 || dow === 0;
  const sick = sickOn(u, wakeDate);
  const prevHard = hardOn(u, addDays(wakeDate, -1));

  const wakeMin = clamp(
    (weekend ? 8 * 60 + 5 : 6 * 60 + 55) + u.persona.chrono * 0.6 + gauss(rng) * 22 + (sick ? 25 : 0),
    6 * 60 + 5,
    8 * 60 + 25,
  );
  const inBed = clamp(
    u.sleepGoalMin + 20 + gauss(rng) * 35 + (sick ? 55 : 0) + (weekend ? 25 : 0) + (prevHard ? 15 : 0),
    400,
    590,
  );
  // Bedtime 22:30 (-90) to 01:00 (+60), whatever the wake time says.
  const bedMin = clamp(wakeMin - inBed + u.persona.chrono * 0.4, -90, 60);

  const bedMs = wallToMs(wakeDate, bedMin, tz);
  const wakeMs = wallToMs(wakeDate, wakeMin, tz);
  const sleepStartMs = bedMs + Math.round(between(rng, 6, 22)) * MIN;
  const sleepEndMs = wakeMs - Math.round(between(rng, 0, 9)) * MIN;

  // 90-minute cycles: light -> deep -> light -> REM, deep sleep early, REM late, brief wake-ups between.
  const stages: Seg[] = [];
  let t = sleepStartMs;
  const push = (stage: Stage, minutes: number) => {
    const end = Math.min(t + Math.max(1, Math.round(minutes)) * MIN, sleepEndMs);
    if (end > t) stages.push({ stage, start: t, end });
    t = end;
  };
  for (let c = 0; t < sleepEndMs; c++) {
    const len = between(rng, 78, 102);
    const deepFrac = Math.max(0.03, 0.27 - 0.07 * c) * (prevHard ? 1.15 : 1);
    const remFrac = Math.min(0.34, 0.09 + 0.07 * c);
    const coreFrac = 1 - deepFrac - remFrac;
    push("core", len * coreFrac * 0.45);
    push("deep", len * deepFrac);
    push("core", len * coreFrac * 0.55);
    push("rem", len * remFrac);
    if (rng() < (sick ? 0.85 : 0.55)) push("awake", between(rng, 2, sick ? 14 : 9));
  }
  // Merge same-stage neighbours (after clamping to the end).
  const merged: Seg[] = [];
  for (const s of stages) {
    const last = merged[merged.length - 1];
    if (last && last.stage === s.stage && last.end === s.start) last.end = s.end;
    else merged.push({ ...s });
  }
  return { wakeDate, bedMs, wakeMs, sleepStartMs, sleepEndMs, stages: merged };
}

export type DayPlan = {
  date: string;
  sick: boolean;
  hard: boolean;
  night: Night | null;
  metrics: Record<string, number | null>;
  /** Minutes of the day's exercise (drives hourly HR too). */
  exerciseMin: number;
};

/** Everything measured on one local date (full-day values; partial days are scaled when the payload is built). */
export function simulateDay(u: DemoUser, date: string): DayPlan {
  const p = u.persona;
  const rng = rngFor(u, date, "day");
  const ed = epochDay(date);
  const dow = dowOf(date);
  const sick = sickOn(u, date);
  const poor = poorOn(u, date);
  const hard = hardOn(u, date);
  const prevHard = hardOn(u, addDays(date, -1));
  const night = simulateNight(u, date);

  const wave = (period: number, phase: number) => Math.sin((2 * Math.PI * ed) / period + phase);
  const age = (Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) - Date.parse(u.dob)) / 31_557_600_000;

  const rhr = clamp(
    p.rhr + wave(28, 1) * 1.4 + gauss(rng) * 1.1 + (sick ? 7.5 : 0) + (poor ? 3 : 0) + (prevHard ? 1.6 : 0),
    48,
    68,
  );
  const hrv = clamp(
    p.hrv * (1 + 0.11 * wave(21, 2)) * Math.exp(gauss(rng) * 0.09) * (sick ? 0.62 : 1) * (poor ? 0.82 : 1) * (prevHard ? 0.9 : 1),
    30,
    90,
  );

  const dowFactor = dow === 6 ? 1.15 : dow === 0 ? 0.88 : 1;
  const steps = clamp(
    p.steps * dowFactor * (hard ? 1.5 : 1) * (sick ? 0.5 : 1) * (poor ? 0.9 : 1) * Math.exp(gauss(rng) * 0.2),
    3000,
    18000,
  );
  const exerciseMin = sick ? Math.round(between(rng, 0, 6)) : hard ? Math.round(between(rng, 45, 95)) : rng() < 0.5 ? Math.round(between(rng, 8, 32)) : 0;
  const standMin = clamp(between(rng, 330, 640) * (sick ? 0.8 : 1), 200, 720);
  const daylightMin = clamp(between(rng, 25, 110) + (dow === 6 || dow === 0 ? 35 : 0), 5, 260);
  const stride = 0.415 * (u.heightCm / 100);
  const activeKcal = clamp(steps * 0.038 * (u.weightKg / 70) + exerciseMin * 6.5 + gauss(rng) * 24, 120, 1400);
  const bmr = 10 * u.weightKg + 6.25 * u.heightCm - 5 * age + (u.sex === "male" ? 5 : -161);

  const all: Record<string, number | null> = {
    steps: Math.round(steps),
    distance_m: round(steps * stride, 1),
    flights: Math.max(0, Math.round((steps / 950) * Math.exp(gauss(rng) * 0.25))),
    active_kcal: round(activeKcal, 1),
    resting_kcal: round(bmr * 1.02 + gauss(rng) * 18, 1),
    exercise_min: exerciseMin,
    stand_min: Math.round(standMin),
    daylight_min: Math.round(daylightMin),
    mindful_min: rng() < 0.15 ? Math.round(between(rng, 5, 15)) : null,
    resting_hr: round(rhr, 1),
    walking_hr_avg: round(rhr + 38 + gauss(rng) * 4 + (hard ? 6 : 0), 1),
    hrv_sdnn_ms: round(hrv, 1),
    vo2max: round(p.vo2max + ed * 0.0006 + gauss(rng) * 0.25, 1),
    spo2_pct: round(clamp(96.9 + gauss(rng) * 0.6 - (sick ? 1.8 : 0), 90, 99.5), 1),
    resp_rate: round(clamp(14.6 + gauss(rng) * 0.5 + (sick ? 1.7 : 0), 10, 22), 1),
    wrist_temp_c: round(35.6 + gauss(rng) * 0.35 + (sick ? 0.75 : 0), 2),
    weight_kg: round(u.weightKg + wave(60, 0) * 0.5 + gauss(rng) * 0.35, 1),
    body_fat_pct: round(19.5 + wave(60, 1) * 0.4 + gauss(rng) * 0.25, 1),
  };
  return { date, sick, hard, night, metrics: all, exerciseMin };
}

/* ------------------------------------------------------------------------ */
/* Hourly heart rate                                                         */
/* ------------------------------------------------------------------------ */

export type HrRow = { hour: number; avg: number; min: number; max: number };

/** Local hour-of-day (fractional) of an instant, on `date` (hours can spill past 24 / below 0). */
function hourOnDate(ms: number, date: string, tz: string): number {
  const p = localParts(ms, tz);
  const d = `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
  return daysBetween(date, d) * 24 + p.hour + p.minute / 60;
}

/** Hourly HR for one local date. `untilHour` (exclusive) cuts a partial day. */
export function hourlyHr(u: DemoUser, plan: DayPlan, untilHour = 24): HrRow[] {
  const rng = rngFor(u, plan.date, "hr");
  const rhr = plan.metrics.resting_hr as number;
  const tz = u.timezone;
  const next = simulateNight(u, addDays(plan.date, 1));
  // Sleep spans: last night's wake hour and tonight's bed hour, on this day's clock.
  const wakeH = plan.night ? hourOnDate(plan.night.wakeMs, plan.date, tz) : 7;
  const bedH = next ? hourOnDate(next.bedMs, plan.date, tz) : 23;
  const bedStartH = plan.night ? hourOnDate(plan.night.bedMs, plan.date, tz) : -1;

  const skip = new Set<number>();
  if (u.profile === "watch" && rng() < 0.4) skip.add(21); // charging
  if (u.profile === "zepp") for (let i = Math.floor(rng() * 4); i > 0; i--) skip.add(Math.floor(between(rng, 9, 22)));
  if (u.profile === "fitbit" && rng() < 0.3) skip.add(Math.floor(between(rng, 0, 24)));
  if (!plan.night) for (const h of [2, 3, 4, 5]) skip.add(h);

  const rows: HrRow[] = [];
  for (let hour = 0; hour < Math.min(24, untilHour); hour++) {
    if (skip.has(hour)) continue;
    const mid = hour + 0.5;
    let avg: number;
    let spread = between(rng, 6, 12);
    let up = between(rng, 12, 30);
    if (mid < wakeH) {
      // asleep: settle to a dip around the middle of the night
      const frac = clamp((mid - Math.max(bedStartH, 0)) / Math.max(wakeH - Math.max(bedStartH, 0), 1), 0, 1);
      avg = rhr - 2 + 6 * (1 - Math.sin(Math.PI * frac)) + gauss(rng) * 1.3;
      spread = between(rng, 3, 7);
      up = between(rng, 5, 14);
    } else if (mid >= bedH) {
      const frac = clamp((mid - bedH) / 2, 0, 1);
      avg = rhr + 6 - 5 * frac + gauss(rng) * 1.5;
      spread = between(rng, 3, 7);
      up = between(rng, 5, 14);
    } else {
      const commute = hour === 8 || hour === 18 ? 8 : 0;
      const daytime = hour >= 9 && hour <= 17 ? 10 : hour >= 18 ? 6 : 4;
      avg = rhr + 14 + commute + daytime + gauss(rng) * 3 + (plan.sick ? 8 : 0);
      if (plan.hard) {
        const w = u.persona.workoutHour;
        if (hour === w) {
          avg = clamp(u.maxHr * between(rng, 0.7, 0.8), 120, 165) + gauss(rng) * 4;
          up = between(rng, 18, 32);
        } else if (hour === w + 1) avg += 22 + gauss(rng) * 3;
        else if (hour === w - 1) avg += 8;
      }
    }
    avg = clamp(avg, 40, 175);
    rows.push({
      hour,
      avg: Math.round(avg),
      min: Math.round(clamp(avg - spread, 38, avg)),
      max: Math.round(clamp(avg + up, avg, 200)),
    });
  }
  return rows;
}

/* ------------------------------------------------------------------------ */
/* Sleep segments per device                                                 */
/* ------------------------------------------------------------------------ */

export type SegmentRow = { stage: string; start: number; end: number; source: string };

const FITBIT_LABEL: Partial<Record<Stage, string>> = { core: "Light", deep: "Deep", rem: "REM", awake: "Awake" };
const APPLE_LABEL: Record<Stage, string> = { in_bed: "In Bed", asleep: "Asleep", awake: "Awake", core: "Core", deep: "Deep", rem: "REM" };

/** The raw Health samples one device writes for a night (start / end in epoch ms). */
export function sleepSegmentsFor(u: DemoUser, plan: DayPlan): SegmentRow[] {
  const n = plan.night;
  if (!n) return [];
  const rng = rngFor(u, plan.date, "segments");
  const out: SegmentRow[] = [];

  if (u.profile === "iphone") {
    out.push({ stage: APPLE_LABEL.in_bed, start: n.bedMs, end: n.wakeMs, source: "iPhone" });
  } else if (u.profile === "watch") {
    out.push({ stage: APPLE_LABEL.in_bed, start: n.bedMs, end: n.wakeMs, source: "iPhone" });
    out.push({ stage: APPLE_LABEL.in_bed, start: n.sleepStartMs - 4 * MIN, end: n.sleepEndMs + 3 * MIN, source: "Apple Watch" });
    for (const s of n.stages) out.push({ stage: APPLE_LABEL[s.stage], start: s.start, end: s.end, source: "Apple Watch" });
  } else if (u.profile === "fitbit") {
    for (const s of n.stages) out.push({ stage: FITBIT_LABEL[s.stage] ?? "Light", start: s.start, end: s.end, source: "Google Health" });
  } else {
    // Zepp: inconsistent stages, so often only "Asleep" blocks split by "Awake".
    let blockStart: number | null = null;
    let blockEnd = 0;
    const flush = () => {
      if (blockStart !== null) out.push({ stage: APPLE_LABEL.asleep, start: blockStart, end: blockEnd, source: "Zepp" });
      blockStart = null;
    };
    for (const s of n.stages) {
      if (s.stage === "awake") {
        flush();
        if (s.end - s.start >= 3 * MIN) out.push({ stage: APPLE_LABEL.awake, start: s.start, end: s.end, source: "Zepp" });
      } else {
        blockStart ??= s.start;
        blockEnd = s.end;
      }
    }
    flush();
  }

  // Now and then a short afternoon nap (ignored by the merge: under an hour, between 10:00 and 18:00).
  if ((u.profile === "watch" || u.profile === "fitbit") && rng() < 0.06) {
    const start = wallToMs(plan.date, between(rng, 13 * 60, 15 * 60), u.timezone);
    const source = u.profile === "watch" ? "Apple Watch" : "Google Health";
    out.push({ stage: u.profile === "watch" ? APPLE_LABEL.core : "Light", start, end: start + Math.round(between(rng, 18, 40)) * MIN, source });
  }
  return out;
}

/* ------------------------------------------------------------------------ */
/* Payloads                                                                  */
/* ------------------------------------------------------------------------ */

type Json = Record<string, unknown>;

const sends = (u: DemoUser, name: string): boolean => {
  if (PROFILE_METRICS[u.profile].includes(name)) return true;
  if (name === "weight_kg") return !!u.persona.scale;
  if (name === "body_fat_pct") return !!u.persona.scale?.bodyFat;
  if (name === "mindful_min") return u.profile === "watch";
  return false;
};

/** Metrics only measured during sleep (null on nights the wearable wasn't worn). */
const SLEEP_MEASURED = new Set(["hrv_sdnn_ms", "resp_rate", "wrist_temp_c", "spo2_pct"]);

/** Local minutes since midnight of `now` in the user's timezone. */
const nowMinutes = (now: Date, tz: string) => {
  const p = localParts(now.getTime(), tz);
  return p.hour * 60 + p.minute;
};

/** One Day object (the `hr_hourly` and sleep parts are added by `buildPayload`). */
function dayObject(u: DemoUser, plan: DayPlan, partial: number): Json {
  const rng = rngFor(u, plan.date, "send");
  const columnar = u.format === "columnar";
  const fmt = (v: number) => (columnar ? String(v) : v);
  const day: Json = { date: plan.date };
  const fullDayTotals = new Set(["steps", "distance_m", "flights", "active_kcal", "exercise_min", "stand_min", "daylight_min"]);

  for (const [name, raw] of Object.entries(plan.metrics)) {
    if (!sends(u, name)) continue;
    if (name === "mindful_min" && raw === null) continue; // not every day has a session: left out
    if (name === "weight_kg" || name === "body_fat_pct") {
      if (rng() > 0.45) continue; // a few weigh-ins a week
    }
    if (name === "vo2max" && rng() > 0.85) continue; // Health updates it every so often
    let v = raw;
    if (v !== null && partial < 1 && fullDayTotals.has(name)) v = Math.round(v * partial ** 0.9 * 10) / 10;
    if (name === "steps" && v !== null) v = Math.round(v);
    const missing =
      (SLEEP_MEASURED.has(name) && !plan.night) ||
      (name === "spo2_pct" && u.profile !== "watch" && rng() < 0.08) ||
      (name === "hrv_sdnn_ms" && rng() < 0.05);
    if (missing || v === null) {
      day[name] = columnar ? "" : null; // an empty Shortcut variable / an explicit null
      continue;
    }
    if (name === "spo2_pct" && columnar) day[name] = String(round((v as number) / 100, 3)); // Health's 0-1 fraction
    else day[name] = fmt(v as number);
  }

  const extra = u.persona.unknownField;
  if (extra && rng() < extra.chance) {
    day[extra.name] = extra.kind === "km" ? round(between(rng, 9, 46), 1) : ["OK", "OK", "Low", "Very Low"][Math.floor(rng() * 4)];
  }
  return day;
}

function hrPayload(u: DemoUser, rows: HrRow[], date: string): unknown {
  const tz = u.timezone;
  const startMs = (hour: number) => wallToMs(date, hour * 60, tz);
  if (u.format === "columnar") {
    return {
      starts: rows.map((r) => isoLocal(startMs(r.hour), tz)).join("\n"),
      avg: rows.map((r) => r.avg).join("\n"),
      min: rows.map((r) => r.min).join("\n"),
      max: rows.map((r) => r.max).join("\n"),
    };
  }
  if (u.format === "bare") return rows.map((r) => ({ start: isoLocal(startMs(r.hour), tz), avg: r.avg, min: r.min, max: r.max }));
  return rows.map((r) => ({ hour: r.hour, avg: r.avg, min: r.min, max: r.max }));
}

function segmentsPayload(u: DemoUser, segs: SegmentRow[]): unknown {
  const tz = u.timezone;
  if (u.format === "columnar") {
    return {
      stages: segs.map((s) => s.stage).join("\n"),
      starts: segs.map((s) => isoLocal(s.start, tz)).join("\n"),
      ends: segs.map((s) => isoLocal(s.end, tz)).join("\n"),
      sources: segs.map((s) => s.source).join("\n"),
    };
  }
  return segs.map((s) => ({ stage: s.stage, start: isoLocal(s.start, tz), end: isoLocal(s.end, tz), source: s.source }));
}

export type PayloadOptions = {
  /** Inclusive local dates. */
  from: string;
  to: string;
  /** "Now" for the user: today's day is partial and a night that hasn't ended yet is left out. */
  now: Date;
};

/**
 * The JSON body of one ingest request for `from..to` (oldest day first).
 * Object forms carry `tz` and top-level `sleep_segments`; the bare-array form
 * carries each night on its wake date's day.
 */
export function buildPayload(u: DemoUser, opts: PayloadOptions): Json | Json[] {
  const tz = u.timezone;
  const today = localDateOf(opts.now.getTime(), tz);
  const days: Json[] = [];
  const topSegments: SegmentRow[] = [];

  for (let date = opts.from; date <= opts.to; date = addDays(date, 1)) {
    const full = simulateDay(u, date);
    const isToday = date === today;
    // A night that hasn't ended yet isn't in Health yet.
    const plan = full.night && full.night.wakeMs > opts.now.getTime() ? { ...full, night: null } : full;
    const minutes = isToday ? nowMinutes(opts.now, tz) : 1440;
    const day = dayObject(u, plan, minutes / 1440);

    if (HAS_HR_HOURLY[u.profile]) {
      const rows = hourlyHr(u, plan, isToday ? Math.floor(minutes / 60) : 24);
      day.hr_hourly = hrPayload(u, rows, date);
    }
    const segs = sleepSegmentsFor(u, plan);
    if (u.format === "bare") {
      if (segs.length) day.sleep_segments = segmentsPayload(u, segs);
    } else {
      topSegments.push(...segs);
    }
    days.push(day);
  }

  if (u.format === "bare") return days;
  const body: Json = { tz, days };
  if (topSegments.length) body.sleep_segments = segmentsPayload(u, topSegments);
  return body;
}

/** `total` days ending at `end`, split into `chunk`-day inclusive ranges, oldest first. */
export function chunkRanges(end: string, total: number, chunk: number): { from: string; to: string }[] {
  const start = addDays(end, -(total - 1));
  const out: { from: string; to: string }[] = [];
  for (let from = start; from <= end; from = addDays(from, chunk)) {
    out.push({ from, to: addDays(from, Math.min(chunk, daysBetween(from, end) + 1) - 1) });
  }
  return out;
}
