/**
 * Browser-side helpers for "Sync now": the Shortcuts URL, opening it, the
 * pending-sync record in sessionStorage, and test hooks.
 *
 * Test hooks: e2e tests set `window.__huddleSync` (via `page.addInitScript`)
 * to capture the `shortcuts://` navigation instead of performing it and to
 * shorten the timers. It only changes behaviour in the browser that sets it.
 */

import { DEFAULT_SYNC_TIMING, type SyncTiming } from "./machine";

export type SyncTestHooks = Partial<SyncTiming> & {
  /** Called instead of navigating to the external URL. */
  openUrl?: (url: string) => void;
};

declare global {
  interface Window {
    __huddleSync?: SyncTestHooks;
  }
}

/**
 * `shortcuts://run-shortcut?name=…&input=text&text=force`. No x-callback:
 * iOS would reopen the x-success URL in Safari rather than the installed PWA.
 * The `force` input makes the Shortcut skip its 45-minute throttle.
 */
export function shortcutRunUrl(name: string): string {
  return `shortcuts://run-shortcut?name=${encodeURIComponent(name)}&input=text&text=force`;
}

/** Navigate to an external-scheme URL. Must be called synchronously from a tap. */
export function openExternalUrl(url: string): void {
  const hook = typeof window !== "undefined" ? window.__huddleSync?.openUrl : undefined;
  if (hook) {
    hook(url);
    return;
  }
  window.location.href = url;
}

/** Default timing, overridden by test hooks. */
export function syncTiming(): SyncTiming {
  const hooks = typeof window !== "undefined" ? window.__huddleSync : undefined;
  const pick = (k: keyof SyncTiming) => {
    const v = hooks?.[k];
    return typeof v === "number" && v > 0 ? v : DEFAULT_SYNC_TIMING[k];
  };
  return { pollMs: pick("pollMs"), timeoutMs: pick("timeoutMs"), stayedMs: pick("stayedMs"), resumeWindowMs: pick("resumeWindowMs") };
}

const PENDING_KEY = "huddle:sync-pending";

export type PendingSync = { startedAt: string; launchedAt: number };

/** sessionStorage can throw (private mode, disabled storage): never let that break the page. */
export function savePendingSync(p: PendingSync): void {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(p));
  } catch {
    // ignore
  }
}

export function readPendingSync(): PendingSync | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<PendingSync>;
    return typeof v.startedAt === "string" && typeof v.launchedAt === "number" ? { startedAt: v.startedAt, launchedAt: v.launchedAt } : null;
  } catch {
    return null;
  }
}

export function clearPendingSync(): void {
  try {
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    // ignore
  }
}
