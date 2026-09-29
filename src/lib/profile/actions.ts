"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { childLogger } from "@/lib/log";
import { requireUser } from "@/lib/session";
import { PROFILE_SECTIONS, type ProfileSection } from "./schema";
import { finishOnboarding, saveAvatarConfig, saveSection } from "./service";
import type { ProfileActionResult } from "./types";

/*
 * Profile + onboarding mutations. Server actions are plain POST endpoints, so
 * each one re-checks the session (the page's check doesn't cover them) and
 * re-validates its input with the shared zod schemas. Logs carry the user id
 * and field NAMES only, never values.
 */

const log = childLogger("profile");
const GENERIC_ERROR = "Something went wrong. Try again.";

function refresh() {
  revalidatePath("/", "layout");
}

/** Save one onboarding step / Profile sheet (`section` selects the schema). */
export async function saveSectionAction(section: ProfileSection, input: unknown): Promise<ProfileActionResult> {
  const user = await requireUser();
  if (!PROFILE_SECTIONS.includes(section)) return { ok: false, error: "Unknown section" };
  try {
    const r = await saveSection(db, user.id, section, input);
    if (!r.ok) {
      log.info({ userId: user.id, section, field: r.field }, "profile save rejected");
      return { ok: false, error: r.error, field: r.field };
    }
    log.info({ userId: user.id, section, fields: r.fields }, "profile saved");
    refresh();
    return { ok: true };
  } catch (err) {
    log.error({ userId: user.id, section, err: err instanceof Error ? err.message : String(err) }, "profile save failed");
    return { ok: false, error: GENERIC_ERROR };
  }
}

/** Switch to a DiceBear character (also deletes any uploaded photo). */
export async function saveAvatarConfigAction(config: unknown): Promise<ProfileActionResult> {
  const user = await requireUser();
  try {
    const r = await saveAvatarConfig(db, user.id, config);
    if (!r.ok) return { ok: false, error: r.error };
    log.info({ userId: user.id, kind: "dicebear" }, "avatar saved");
    refresh();
    return { ok: true };
  } catch (err) {
    log.error({ userId: user.id, err: err instanceof Error ? err.message : String(err) }, "avatar save failed");
    return { ok: false, error: GENERIC_ERROR };
  }
}

const FINISH_TARGETS = ["/home", "/setup"] as const;
export type FinishTarget = (typeof FINISH_TARGETS)[number];

/**
 * Complete onboarding (sets onboarded_at) and go to `next`. Only returns on
 * failure; `missing` names the step to send the user back to.
 */
export async function finishOnboardingAction(
  next: FinishTarget = "/home",
): Promise<{ ok: false; error: string; missing?: string }> {
  const user = await requireUser();
  const target = FINISH_TARGETS.includes(next) ? next : "/home";
  let failure: { ok: false; error: string; missing?: string } | null = null;
  try {
    const r = await finishOnboarding(db, user.id);
    if (!r.ok) failure = r;
  } catch (err) {
    log.error({ userId: user.id, err: err instanceof Error ? err.message : String(err) }, "finish onboarding failed");
    failure = { ok: false, error: GENERIC_ERROR };
  }
  if (failure) {
    log.info({ userId: user.id, missing: failure.missing }, "onboarding incomplete");
    return failure;
  }
  log.info({ userId: user.id }, "onboarding finished");
  refresh();
  redirect(target);
}
