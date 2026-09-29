"use client";

import { useEffect, useState } from "react";
import { usernameSchema } from "@/lib/profile/schema";
import { firstIssue } from "@/lib/admin/schemas";

export type UsernameStatus =
  | { state: "idle" }
  | { state: "invalid"; message: string }
  | { state: "checking" }
  | { state: "available" }
  | { state: "taken"; message: string }
  | { state: "error" };

const DEBOUNCE_MS = 350;

/** Local (offline) verdict for a candidate, or null when it needs a server check. */
function localVerdict(value: string): UsernameStatus | null {
  if (value === "") return { state: "idle" };
  const parsed = usernameSchema.safeParse(value);
  if (!parsed.success) return { state: "invalid", message: firstIssue(parsed.error) };
  return null;
}

type Remote = { for: string; status: UsernameStatus };

/**
 * Live availability of `value`: validates locally right away, then (debounced)
 * asks GET /api/me/username. `own` is the user's saved username (always fine).
 * A network failure yields `error`, which callers treat as "unknown": the
 * server re-checks when saving.
 */
export function useUsernameStatus(value: string, opts: { own?: string | null; enabled?: boolean } = {}): UsernameStatus {
  const { own, enabled = true } = opts;
  const [remote, setRemote] = useState<Remote | null>(null);

  const local = localVerdict(value);
  const needsRemote = enabled && local === null && value !== own;

  useEffect(() => {
    if (!needsRemote) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/me/username?u=${encodeURIComponent(value)}`, { signal: controller.signal });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { available: boolean; message?: string };
        setRemote({
          for: value,
          status: body.available ? { state: "available" } : { state: "taken", message: body.message ?? "That username is taken" },
        });
      } catch (err) {
        if ((err as Error).name !== "AbortError") setRemote({ for: value, status: { state: "error" } });
      }
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [needsRemote, value]);

  if (local) return local;
  if (!enabled || value === own) return { state: "available" };
  if (remote && remote.for === value) return remote.status;
  return { state: "checking" };
}

/** Can the user move on with this status? (`error` = unknown; the server decides.) */
export function usernameBlocks(status: UsernameStatus): boolean {
  return status.state === "invalid" || status.state === "taken" || status.state === "idle";
}
