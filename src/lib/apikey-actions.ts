"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { createKeyForUser, ensureKeyForUser, getKeyStatus, revokeKeysForUser, type KeyStatus } from "@/lib/apikey";
import { childLogger } from "@/lib/log";
import { requireUser } from "@/lib/session";

/*
 * API key mutations. Server actions are public POST endpoints, so each one
 * re-checks the session. The plaintext key is returned exactly once (to the
 * caller that created it) and is never logged.
 */

const log = childLogger("apikey");
const GENERIC_ERROR = "Something went wrong. Try again.";

/** Serializable key status for client components. */
export type KeyStatusDTO = {
  active: boolean;
  prefixHint: string | null;
  createdAt: string | null;
  lastUsedAt: string | null;
};

export type KeyActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

function toDTO(s: KeyStatus): KeyStatusDTO {
  return {
    active: s.active,
    prefixHint: s.prefixHint,
    createdAt: s.createdAt?.toISOString() ?? null,
    lastUsedAt: s.lastUsedAt?.toISOString() ?? null,
  };
}

function refresh() {
  revalidatePath("/profile");
  revalidatePath("/setup");
}

/** Revoke the current key (if any) and issue a new one. The only time the new key is readable. */
export async function regenerateKeyAction(): Promise<KeyActionResult<{ key: string; status: KeyStatusDTO }>> {
  const user = await requireUser();
  try {
    const created = await createKeyForUser(db, user.id);
    refresh();
    return {
      ok: true,
      key: created.key,
      status: { active: true, prefixHint: created.prefixHint, createdAt: created.createdAt.toISOString(), lastUsedAt: null },
    };
  } catch (err) {
    log.error({ userId: user.id, err: err instanceof Error ? err.message : String(err) }, "api key regenerate failed");
    return { ok: false, error: GENERIC_ERROR };
  }
}

/** Revoke the current key; the Shortcut stops syncing until a new key is created. */
export async function revokeKeyAction(): Promise<KeyActionResult<{ status: KeyStatusDTO }>> {
  const user = await requireUser();
  try {
    await revokeKeysForUser(db, user.id);
    refresh();
    return { ok: true, status: { active: false, prefixHint: null, createdAt: null, lastUsedAt: null } };
  } catch (err) {
    log.error({ userId: user.id, err: err instanceof Error ? err.message : String(err) }, "api key revoke failed");
    return { ok: false, error: GENERIC_ERROR };
  }
}

/**
 * Onboarding: create the user's first key if they have none. `key` is the
 * plaintext when one was just created, or null when an active key already
 * existed (it can't be shown again; `status` describes it).
 */
export async function ensureOnboardingKeyAction(): Promise<KeyActionResult<{ key: string | null; status: KeyStatusDTO }>> {
  const user = await requireUser();
  try {
    const created = await ensureKeyForUser(db, user.id);
    if (created) {
      return {
        ok: true,
        key: created.key,
        status: { active: true, prefixHint: created.prefixHint, createdAt: created.createdAt.toISOString(), lastUsedAt: null },
      };
    }
    return { ok: true, key: null, status: toDTO(await getKeyStatus(db, user.id)) };
  } catch (err) {
    log.error({ userId: user.id, err: err instanceof Error ? err.message : String(err) }, "api key ensure failed");
    return { ok: false, error: GENERIC_ERROR };
  }
}
