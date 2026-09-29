import { createHash } from "node:crypto";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { and, eq, isNull, ne } from "drizzle-orm";
import type { db as defaultDb } from "@/db";
import { users, type User } from "@/db/schema";
import { defaultConfigForSeed, parseAvatarConfig } from "@/lib/avatar/config";
import { avatarDir, resolveUploadPath } from "@/lib/avatar/serve";
import { firstIssue } from "@/lib/admin/schemas";
import { incompleteSteps, type OnboardingStep } from "./progress";
import type { ProfileData } from "./types";
import { isReservedUsername, SECTION_SCHEMAS, usernameSchema, type ProfileSection } from "./schema";

/*
 * Profile persistence. Plain functions over a Drizzle handle (no session, no
 * Next APIs) so integration tests can call them directly; the server actions
 * in ./actions.ts add requireUser(), logging and cache revalidation.
 */

type Db = typeof defaultDb;

export type ServiceResult<T = object> =
  | ({ ok: true } & T)
  | { ok: false; error: string; field?: string; code?: string };

const TAKEN = "That username is taken";

// ---------------------------------------------------------------------------
// Username availability
// ---------------------------------------------------------------------------

export type UsernameCheck =
  | { available: true; own?: boolean }
  | { available: false; reason: "invalid" | "reserved" | "taken"; message: string };

/** Validate a candidate username and check it against the users table. `selfId` is excluded (keeping your own name is fine). */
export async function checkUsername(db: Db, candidate: unknown, selfId?: string): Promise<UsernameCheck> {
  const parsed = usernameSchema.safeParse(candidate);
  if (!parsed.success) {
    const raw = typeof candidate === "string" ? candidate.trim().toLowerCase() : "";
    return {
      available: false,
      reason: raw && isReservedUsername(raw) ? "reserved" : "invalid",
      message: firstIssue(parsed.error),
    };
  }
  const name = parsed.data;
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(selfId ? and(eq(users.username, name), ne(users.id, selfId)) : eq(users.username, name))
    .limit(1);
  if (rows.length > 0) return { available: false, reason: "taken", message: TAKEN };
  return { available: true };
}

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}

// ---------------------------------------------------------------------------
// Sections (identity / basics / body / goals / personal / preferences)
// ---------------------------------------------------------------------------

/** Validate one section's fields and write them. Returns the saved field names. */
export async function saveSection(
  db: Db,
  userId: string,
  section: ProfileSection,
  raw: unknown,
): Promise<ServiceResult<{ fields: string[] }>> {
  const schema = SECTION_SCHEMAS[section];
  if (!schema) return { ok: false, error: "Unknown section" };
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: firstIssue(parsed.error), field: issue ? String(issue.path[0] ?? "") : undefined };
  }
  const data = parsed.data as Record<string, unknown>;
  try {
    const updated = await db.update(users).set(data).where(eq(users.id, userId)).returning({ id: users.id });
    if (updated.length === 0) return { ok: false, error: "Account not found" };
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, error: TAKEN, field: "username", code: "username_taken" };
    throw err;
  }
  return { ok: true, fields: Object.keys(data) };
}

// ---------------------------------------------------------------------------
// Avatar
// ---------------------------------------------------------------------------

async function removeUploadFile(dir: string, stored: string | null | undefined): Promise<void> {
  if (!stored) return;
  const file = resolveUploadPath(dir, stored);
  if (!file) return;
  await unlink(/*turbopackIgnore: true*/ file).catch((err: NodeJS.ErrnoException) => {
    if (err.code !== "ENOENT") throw err;
  });
}

async function currentAvatarPath(db: Db, userId: string): Promise<string | null> {
  const [row] = await db.select({ avatarPath: users.avatarPath }).from(users).where(eq(users.id, userId)).limit(1);
  return row?.avatarPath ?? null;
}

/** Switch to a DiceBear character (validated) and delete any uploaded photo. */
export async function saveAvatarConfig(
  db: Db,
  userId: string,
  raw: unknown,
  dir: string = avatarDir(),
): Promise<ServiceResult> {
  const config = parseAvatarConfig(raw);
  if (!config) return { ok: false, error: "That avatar isn't valid" };
  const previous = await currentAvatarPath(db, userId);
  const updated = await db
    .update(users)
    .set({ avatarKind: "dicebear", avatarConfig: config, avatarPath: null })
    .where(eq(users.id, userId))
    .returning({ id: users.id });
  if (updated.length === 0) return { ok: false, error: "Account not found" };
  await removeUploadFile(dir, previous);
  return { ok: true };
}

/**
 * Store an already re-encoded 512px WebP as the user's avatar:
 * `${dir}/${userId}-${hash}.webp`, then delete the previous upload.
 * The DiceBear config is kept so the user can switch back to it.
 */
export async function saveAvatarUpload(
  db: Db,
  userId: string,
  webp: Buffer,
  dir: string = avatarDir(),
): Promise<ServiceResult<{ avatarPath: string }>> {
  const hash = createHash("sha256").update(webp).digest("hex").slice(0, 12);
  const filename = `${userId}-${hash}.webp`;
  const target = resolveUploadPath(dir, filename);
  if (!target) return { ok: false, error: "Invalid avatar path" };

  const previous = await currentAvatarPath(db, userId);
  await mkdir(/*turbopackIgnore: true*/ dir, { recursive: true });
  const tmp = `${target}.${process.pid}.tmp`;
  await writeFile(/*turbopackIgnore: true*/ tmp, webp);
  await rename(/*turbopackIgnore: true*/ tmp, /*turbopackIgnore: true*/ target);

  const updated = await db
    .update(users)
    .set({ avatarKind: "upload", avatarPath: filename })
    .where(eq(users.id, userId))
    .returning({ id: users.id });
  if (updated.length === 0) {
    await removeUploadFile(dir, filename);
    return { ok: false, error: "Account not found" };
  }
  if (previous && previous !== filename) await removeUploadFile(dir, previous);
  return { ok: true, avatarPath: filename };
}

// ---------------------------------------------------------------------------
// Finish
// ---------------------------------------------------------------------------

/**
 * Mark onboarding complete. Requires every step's draft fields (the avatar
 * step is the exception: a missing avatar gets the seeded default). Idempotent.
 */
export async function finishOnboarding(
  db: Db,
  userId: string,
): Promise<{ ok: true } | { ok: false; error: string; missing?: OnboardingStep }> {
  const [user] = await db.select().from(users).where(and(eq(users.id, userId), isNull(users.deactivatedAt))).limit(1);
  if (!user) return { ok: false, error: "Account not found" };

  const missing = incompleteSteps(user).filter((s) => s !== "avatar");
  if (missing.length > 0) {
    return { ok: false, error: "Finish the earlier steps first", missing: missing[0] };
  }

  await db
    .update(users)
    .set({
      onboardedAt: user.onboardedAt ?? new Date(),
      ...(user.avatarKind ? {} : { avatarKind: "dicebear" as const, avatarConfig: defaultConfigForSeed(user.id) }),
    })
    .where(eq(users.id, userId));
  return { ok: true };
}

/** The user row as the profile UI needs it (serializable). */
export function toProfileData(user: User): ProfileData {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    displayName: user.displayName,
    isAdmin: user.isAdmin,
    createdAt: user.createdAt.toISOString(),
    avatarKind: user.avatarKind,
    avatarConfig: parseAvatarConfig(user.avatarConfig),
    avatarPath: user.avatarPath,
    timezone: user.timezone,
    units: user.units,
    dob: user.dob,
    sex: user.sex,
    heightCm: user.heightCm,
    weightKg: user.weightKg,
    maxHr: user.maxHr,
    stepGoal: user.stepGoal,
    sleepGoalMin: user.sleepGoalMin,
  };
}
