import { z } from "zod";
import { isValidTimezone } from "@/lib/admin/timezones";

/*
 * Shared profile validation: used by the onboarding stepper, the Profile edit
 * sheets and the server actions (which re-validate everything). Pure (zod
 * only), so it is safe in client bundles and unit tests.
 */

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
export const DISPLAY_NAME_MAX = 40;

/** Names that would look official or collide with routes. */
export const RESERVED_USERNAMES: ReadonlySet<string> = new Set([
  "admin",
  "administrator",
  "api",
  "app",
  "auth",
  "credits",
  "denied",
  "help",
  "home",
  "huddle",
  "install",
  "login",
  "logout",
  "me",
  "moderator",
  "mod",
  "null",
  "onboarding",
  "privacy",
  "profile",
  "root",
  "settings",
  "setup",
  "signin",
  "signout",
  "staff",
  "support",
  "sync",
  "system",
  "team",
  "undefined",
]);

export function isReservedUsername(name: string): boolean {
  return RESERVED_USERNAMES.has(name.toLowerCase());
}

/** Trimmed, lowercased, 3-20 chars of a-z 0-9 _, not reserved. */
export const usernameSchema = z
  .string({ error: "Pick a username" })
  .trim()
  .toLowerCase()
  .min(USERNAME_MIN, `Use at least ${USERNAME_MIN} characters`)
  .max(USERNAME_MAX, `Keep it to ${USERNAME_MAX} characters or fewer`)
  .regex(/^[a-z0-9_]+$/, "Letters, numbers and underscores only")
  .refine((v) => !isReservedUsername(v), "That username is reserved");

export const displayNameSchema = z
  .string({ error: "Enter your name" })
  .trim()
  .min(1, "Enter your name")
  .max(DISPLAY_NAME_MAX, `Keep it to ${DISPLAY_NAME_MAX} characters or fewer`);

// ---------------------------------------------------------------------------
// Basics
// ---------------------------------------------------------------------------

export const UNITS = ["metric", "imperial"] as const;
export const unitsSchema = z.enum(UNITS, { error: "Pick a unit system" });

export const SEXES = ["male", "female", "other", "unspecified"] as const;
export type Sex = (typeof SEXES)[number];
export const SEX_LABELS: Record<Sex, string> = {
  male: "Male",
  female: "Female",
  other: "Other",
  unspecified: "Prefer not to say",
};
export const sexSchema = z.enum(SEXES, { error: "Pick an option" });

export const timezoneSchema = z
  .string({ error: "Pick a timezone" })
  .refine(isValidTimezone, "Unknown timezone");

export const MIN_AGE = 13;
export const MAX_AGE = 100;

/** Whole years between an ISO date (YYYY-MM-DD) and `now` (UTC). NaN when invalid. */
export function ageOn(dob: string, now: Date = new Date()): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob);
  if (!m) return NaN;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return NaN;
  let age = now.getUTCFullYear() - y;
  const beforeBirthday = now.getUTCMonth() + 1 < mo || (now.getUTCMonth() + 1 === mo && now.getUTCDate() < d);
  if (beforeBirthday) age -= 1;
  return age;
}

/** Date of birth as YYYY-MM-DD; the user must be 13-100 years old. */
export const dobSchema = z
  .string({ error: "Enter your date of birth" })
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter your date of birth")
  .superRefine((v, ctx) => {
    const age = ageOn(v);
    if (Number.isNaN(age)) {
      ctx.addIssue({ code: "custom", message: "That date doesn't exist" });
    } else if (age < MIN_AGE) {
      ctx.addIssue({ code: "custom", message: `You must be at least ${MIN_AGE} to use Huddle` });
    } else if (age > MAX_AGE) {
      ctx.addIssue({ code: "custom", message: "Check the year: that date looks too far back" });
    }
  });

/** Earliest / latest DOB the age rule allows, as YYYY-MM-DD (for the date input's min/max). */
export function dobBounds(now: Date = new Date()): { min: string; max: string } {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const y = now.getUTCFullYear();
  // Feb 29 in a non-leap year rolls to Mar 1 with Date.UTC; that is fine for a bound.
  const at = (year: number) => new Date(Date.UTC(year, now.getUTCMonth(), now.getUTCDate()));
  return { min: iso(at(y - MAX_AGE - 1)), max: iso(at(y - MIN_AGE)) };
}

// ---------------------------------------------------------------------------
// Body
// ---------------------------------------------------------------------------

export const HEIGHT_CM = { min: 100, max: 250 } as const;
export const WEIGHT_KG = { min: 30, max: 300 } as const;
export const MAX_HR = { min: 100, max: 230 } as const;

export const heightCmSchema = z
  .number({ error: "Enter your height" })
  .min(HEIGHT_CM.min, `Height must be at least ${HEIGHT_CM.min} cm`)
  .max(HEIGHT_CM.max, `Height must be at most ${HEIGHT_CM.max} cm`);

export const weightKgSchema = z
  .number({ error: "Enter your weight" })
  .min(WEIGHT_KG.min, `Weight must be at least ${WEIGHT_KG.min} kg`)
  .max(WEIGHT_KG.max, `Weight must be at most ${WEIGHT_KG.max} kg`);

/** Optional: null clears it (Huddle then uses the age-based estimate). */
export const maxHrSchema = z
  .number({ error: "Enter a number, or leave it blank" })
  .int("Use a whole number")
  .min(MAX_HR.min, `Max heart rate must be ${MAX_HR.min}-${MAX_HR.max} bpm`)
  .max(MAX_HR.max, `Max heart rate must be ${MAX_HR.min}-${MAX_HR.max} bpm`)
  .nullable();

/** Tanaka formula: 208 - 0.7 x age. */
export function estimatedMaxHr(age: number): number {
  return Math.round(208 - 0.7 * age);
}

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

export const STEP_GOAL = { min: 1000, max: 50000, step: 500, default: 8000 } as const;
export const SLEEP_GOAL_MIN = { min: 300, max: 720, step: 15, default: 480 } as const;

export const stepGoalSchema = z
  .number({ error: "Set a step goal" })
  .int("Use a whole number")
  .min(STEP_GOAL.min, `Step goal must be at least ${STEP_GOAL.min.toLocaleString("en-US")}`)
  .max(STEP_GOAL.max, `Step goal must be at most ${STEP_GOAL.max.toLocaleString("en-US")}`);

export const sleepGoalSchema = z
  .number({ error: "Set a sleep goal" })
  .int("Use whole minutes")
  .min(SLEEP_GOAL_MIN.min, "Sleep goal must be at least 5 hours")
  .max(SLEEP_GOAL_MIN.max, "Sleep goal must be at most 12 hours")
  .refine((v) => v % SLEEP_GOAL_MIN.step === 0, "Use 15-minute steps");

// ---------------------------------------------------------------------------
// Sections (one schema per onboarding step / Profile sheet)
// ---------------------------------------------------------------------------

export const identitySchema = z.object({ username: usernameSchema, displayName: displayNameSchema });
export const basicsSchema = z.object({
  timezone: timezoneSchema,
  units: unitsSchema,
  dob: dobSchema,
  sex: sexSchema,
});
export const bodySchema = z.object({ heightCm: heightCmSchema, weightKg: weightKgSchema, maxHr: maxHrSchema });
export const goalsSchema = z.object({ stepGoal: stepGoalSchema, sleepGoalMin: sleepGoalSchema });

/** Profile > Personal: the identity fields plus DOB and sex. */
export const personalSchema = z.object({
  displayName: displayNameSchema,
  username: usernameSchema,
  dob: dobSchema,
  sex: sexSchema,
});
/** Profile > Preferences. */
export const preferencesSchema = z.object({ timezone: timezoneSchema, units: unitsSchema });

export const SECTION_SCHEMAS = {
  identity: identitySchema,
  basics: basicsSchema,
  body: bodySchema,
  goals: goalsSchema,
  personal: personalSchema,
  preferences: preferencesSchema,
} as const;

export type ProfileSection = keyof typeof SECTION_SCHEMAS;
export const PROFILE_SECTIONS = Object.keys(SECTION_SCHEMAS) as ProfileSection[];
export type SectionInput<S extends ProfileSection> = z.input<(typeof SECTION_SCHEMAS)[S]>;
export type SectionData<S extends ProfileSection> = z.output<(typeof SECTION_SCHEMAS)[S]>;

/** First issue per field, as `{ field: "message" }` (empty when valid). */
export function fieldErrors(schema: z.ZodType, data: unknown): Record<string, string> {
  const r = schema.safeParse(data);
  if (r.success) return {};
  const out: Record<string, string> = {};
  for (const issue of r.error.issues) {
    const key = String(issue.path[0] ?? "_");
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Unit conversions (storage is always cm / kg)
// ---------------------------------------------------------------------------

const CM_PER_IN = 2.54;
const KG_PER_LB = 0.45359237;

const round = (n: number, decimals: number) => {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
};

/** Feet + inches to centimetres (1 decimal). */
export function ftInToCm(ft: number, inch: number): number {
  return round((ft * 12 + inch) * CM_PER_IN, 1);
}

/** Centimetres to whole feet + inches (inches rounded; 12 rolls over to the next foot). */
export function cmToFtIn(cm: number): { ft: number; in: number } {
  const totalIn = Math.round(cm / CM_PER_IN);
  return { ft: Math.floor(totalIn / 12), in: totalIn % 12 };
}

/** Pounds to kilograms (2 decimals). */
export function lbToKg(lb: number): number {
  return round(lb * KG_PER_LB, 2);
}

/** Kilograms to pounds (1 decimal). */
export function kgToLb(kg: number): number {
  return round(kg / KG_PER_LB, 1);
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

export function formatHeight(cm: number, units: "metric" | "imperial"): string {
  if (units === "imperial") {
    const { ft, in: inch } = cmToFtIn(cm);
    return `${ft}′${inch}″`;
  }
  return `${Math.round(cm)} cm`;
}

export function formatWeight(kg: number, units: "metric" | "imperial"): string {
  return units === "imperial" ? `${Math.round(kgToLb(kg))} lb` : `${round(kg, 1)} kg`;
}

/** 480 -> "8h 00m". */
export function formatSleepGoal(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}
