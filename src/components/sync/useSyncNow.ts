"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  clearPendingSync,
  openExternalUrl,
  readPendingSync,
  savePendingSync,
  shortcutRunUrl,
  syncTiming,
} from "@/lib/sync/launch";
import { IDLE, isSettled, syncReducer, type SyncEvent, type SyncSnapshot, type SyncState } from "@/lib/sync/machine";

/** Refresh the idle snapshot (and so the server-clock offset) this often. */
const IDLE_REFRESH_MS = 30_000;
/**
 * Place the tap slightly later than the estimate. Only attempts after it count,
 * and the Shortcut can't post within a quarter second of the tap, whereas an
 * automation run just before the tap must not be mistaken for this one.
 */
const START_BIAS_MS = 250;

async function fetchStatus(signal?: AbortSignal): Promise<SyncSnapshot | null> {
  try {
    const res = await fetch("/api/me/sync-status", { cache: "no-store", credentials: "same-origin", signal });
    if (!res.ok) return null;
    return (await res.json()) as SyncSnapshot;
  } catch {
    return null;
  }
}

/**
 * Sync now: opens the Shortcut from the tap, then follows it through
 * `syncReducer` with visibility events and `/api/me/sync-status` polling.
 * Returns the machine state, the latest status snapshot and the actions.
 */
export function useSyncNow<S extends SyncSnapshot>(shortcutName: string, initial: S) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<S>(initial);
  // Server clock ≈ client clock + offset, measured on every status fetch.
  const offset = useRef<number>(0);
  const [state, dispatch] = useReducer(
    (s: SyncState, e: SyncEvent) => syncReducer(s, e, syncTiming()),
    IDLE,
  );

  const absorb = useCallback((next: SyncSnapshot | null, requestedAt: number) => {
    if (!next) return null;
    const receivedAt = Date.now();
    const server = Date.parse(next.server_time);
    if (Number.isFinite(server)) offset.current = server - (requestedAt + receivedAt) / 2;
    setSnapshot(next as S);
    return next;
  }, []);

  // Clock offset from the server-rendered snapshot until the first fetch.
  useEffect(() => {
    const server = Date.parse(initial.server_time);
    if (Number.isFinite(server)) offset.current = server - Date.now();
  }, [initial.server_time]);

  // Came back after iOS reloaded the PWA? Pick the pending sync up again.
  useEffect(() => {
    const pending = readPendingSync();
    if (!pending) return;
    if (document.visibilityState === "visible") {
      dispatch({ type: "resume", startedAt: pending.startedAt, launchedAt: pending.launchedAt, now: Date.now() });
    }
  }, [dispatch]);

  // Visibility: hidden = the user went to Shortcuts; visible/focus/pageshow = back.
  useEffect(() => {
    const onVisibility = () =>
      dispatch({ type: document.visibilityState === "hidden" ? "hidden" : "visible", now: Date.now() });
    const onBack = () => document.visibilityState === "visible" && dispatch({ type: "visible", now: Date.now() });
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onBack);
    window.addEventListener("pageshow", onBack);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onBack);
      window.removeEventListener("pageshow", onBack);
    };
  }, [dispatch]);

  // Launching and still here after a few seconds → "Open this on your iPhone".
  const launchedAt = state.phase === "launching" ? state.launchedAt : null;
  useEffect(() => {
    if (launchedAt === null) return;
    const { stayedMs } = syncTiming();
    const id = window.setTimeout(() => dispatch({ type: "stay-check", now: Date.now() }), stayedMs);
    return () => window.clearTimeout(id);
  }, [launchedAt, dispatch]);

  // Waiting: poll now, then every pollMs, until settled.
  const waitingSince = state.phase === "waiting" ? state.since : null;
  useEffect(() => {
    if (waitingSince === null) return;
    const { pollMs } = syncTiming();
    const ctrl = new AbortController();
    let timer: number | undefined;
    let stopped = false;
    const poll = async () => {
      const requestedAt = Date.now();
      const next = absorb(await fetchStatus(ctrl.signal), requestedAt);
      if (stopped) return;
      dispatch(next ? { type: "status", snapshot: next, now: Date.now() } : { type: "tick", now: Date.now() });
      timer = window.setTimeout(poll, pollMs);
    };
    void poll();
    return () => {
      stopped = true;
      ctrl.abort();
      window.clearTimeout(timer);
    };
  }, [waitingSince, absorb, dispatch]);

  // Idle: keep the snapshot (and the clock offset) fresh while the page is open.
  const idle = state.phase === "idle" || isSettled(state);
  useEffect(() => {
    if (!idle) return;
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      const requestedAt = Date.now();
      void fetchStatus().then((s) => absorb(s, requestedAt));
    };
    refresh();
    const id = window.setInterval(refresh, IDLE_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [idle, absorb]);

  // Settled: forget the pending launch; on success refresh server data (Home, this page).
  const phase = state.phase;
  useEffect(() => {
    if (phase !== "synced" && phase !== "error" && phase !== "timeout") return;
    clearPendingSync();
    if (phase === "synced") {
      try {
        navigator.vibrate?.(18);
      } catch {
        // not supported
      }
      router.refresh();
    }
  }, [phase, router]);

  /** Must run synchronously inside the tap handler (iOS only opens other apps from a user gesture). */
  const launch = useCallback(() => {
    const now = Date.now();
    const startedAt = new Date(now + offset.current + START_BIAS_MS).toISOString();
    savePendingSync({ startedAt, launchedAt: now });
    dispatch({ type: "launch", startedAt, now });
    openExternalUrl(shortcutRunUrl(shortcutName));
  }, [shortcutName, dispatch]);

  const reset = useCallback(() => {
    clearPendingSync();
    dispatch({ type: "reset" });
  }, [dispatch]);

  return { state, snapshot, launch, reset };
}
