/**
 * "Sync now" state machine: a pure reducer, driven by the Sync page.
 *
 *   idle ──launch──▶ launching ──hidden──▶ (left the app) ──visible──▶ waiting
 *                        │                                               │
 *                        └─ still visible after `stayedMs` ─▶ stayed      ├─ 200 after startedAt ─▶ synced
 *                           (desktop / Android: shortcuts:// did nothing) ├─ non-200 after startedAt ─▶ error
 *                                                                         └─ nothing for `timeoutMs` ─▶ timeout
 *
 * The page opens `shortcuts://run-shortcut?...` from the tap, iOS switches to
 * Shortcuts (the page is hidden), and when the user swipes back the page
 * becomes visible and polls `GET /api/me/sync-status`. A result counts only if
 * its `last_attempt.at` is after `startedAt` (server clock, so client clock
 * skew doesn't matter). iOS may also reload the PWA on return: the page then
 * `resume`s from sessionStorage.
 *
 * Times: `now` / `launchedAt` / `since` are client epoch ms; `startedAt` and
 * snapshot timestamps are server ISO strings. Keep this file free of path
 * aliases and runtime imports (client + unit tests).
 */

import type { DateRange } from "../ingest/types";
import type { LastAttempt } from "./attempt";

/** The parts of `GET /api/me/sync-status` the machine reads. */
export type SyncSnapshot = {
  last_sync_at: string | null;
  last_payload_dates: DateRange | null;
  last_attempt: LastAttempt | null;
  server_time: string;
};

export type SyncTiming = {
  /** Poll interval while waiting. */
  pollMs: number;
  /** Give up this long after the page became visible again. */
  timeoutMs: number;
  /** Still visible this long after the tap → Shortcuts didn't open. */
  stayedMs: number;
  /** A launch older than this is forgotten (not resumed, not waited for). */
  resumeWindowMs: number;
};

export const DEFAULT_SYNC_TIMING: SyncTiming = {
  pollMs: 3_000,
  timeoutMs: 60_000,
  stayedMs: 4_000,
  resumeWindowMs: 5 * 60_000,
};

type Launch = {
  /** Server time of the tap (ISO). Only attempts after it count. */
  startedAt: string;
  /** Client time of the tap (ms), for the resume window. */
  launchedAt: number;
};

export type SyncState =
  | { phase: "idle" }
  /** Tapped; waiting for iOS to switch to Shortcuts. `left` = the page was hidden since. */
  | ({ phase: "launching"; left: boolean } & Launch)
  /** Tapped, but the page never went away (no Shortcuts app here). */
  | ({ phase: "stayed" } & Launch)
  /** Back from Shortcuts; polling since `since` (client ms). */
  | ({ phase: "waiting"; since: number; left: boolean } & Launch)
  /** A 200 arrived. `days` = dates in its payload (0 = nothing new). */
  | ({ phase: "synced"; days: number; range: DateRange | null; at: string } & Launch)
  /** A non-200 arrived. */
  | ({ phase: "error"; status: number; error?: string; at: string } & Launch)
  /** Nothing arrived within `timeoutMs`. */
  | ({ phase: "timeout" } & Launch);

export type SyncPhase = SyncState["phase"];

export type SyncEvent =
  | { type: "launch"; startedAt: string; now: number }
  | { type: "resume"; startedAt: string; launchedAt: number; now: number }
  | { type: "hidden"; now: number }
  | { type: "visible"; now: number }
  | { type: "stay-check"; now: number }
  | { type: "status"; snapshot: SyncSnapshot; now: number }
  | { type: "tick"; now: number }
  | { type: "reset" };

export const IDLE: SyncState = { phase: "idle" };

/** Inclusive number of dates in a `YYYY-MM-DD` range (0 when missing or inverted). */
export function daysInRange(range: DateRange | null | undefined): number {
  if (!range) return 0;
  const from = Date.parse(`${range.from}T00:00:00Z`);
  const to = Date.parse(`${range.to}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return 0;
  return Math.round((to - from) / 86_400_000) + 1;
}

/** Is there an ingest attempt newer than `startedAt` in this snapshot? */
export function attemptSince(snapshot: SyncSnapshot, startedAt: string): LastAttempt | null {
  const a = snapshot.last_attempt;
  if (!a) return null;
  const at = Date.parse(a.at);
  const start = Date.parse(startedAt);
  return Number.isFinite(at) && Number.isFinite(start) && at > start ? a : null;
}

/** Terminal phases: the machine only leaves them on `launch` / `reset`. */
export function isSettled(state: SyncState): boolean {
  return state.phase === "synced" || state.phase === "error" || state.phase === "timeout";
}

export function syncReducer(state: SyncState, event: SyncEvent, timing: SyncTiming = DEFAULT_SYNC_TIMING): SyncState {
  switch (event.type) {
    case "reset":
      return IDLE;

    case "launch":
      return { phase: "launching", startedAt: event.startedAt, launchedAt: event.now, left: false };

    case "resume":
      if (state.phase !== "idle") return state;
      if (event.now - event.launchedAt > timing.resumeWindowMs) return state;
      return { phase: "waiting", startedAt: event.startedAt, launchedAt: event.launchedAt, since: event.now, left: false };

    case "hidden":
      if (state.phase === "launching" || state.phase === "waiting") return state.left ? state : { ...state, left: true };
      if (state.phase === "stayed") {
        // Shortcuts opened late after all.
        return { phase: "launching", startedAt: state.startedAt, launchedAt: state.launchedAt, left: true };
      }
      return state;

    case "visible": {
      if (state.phase !== "launching" && state.phase !== "waiting") return state;
      if (!state.left) return state; // a focus event without having left: nothing happened yet
      if (event.now - state.launchedAt > timing.resumeWindowMs) return IDLE;
      // Back from Shortcuts (again): poll for a fresh `timeoutMs`.
      return { phase: "waiting", startedAt: state.startedAt, launchedAt: state.launchedAt, since: event.now, left: false };
    }

    case "stay-check":
      if (state.phase === "launching" && !state.left && event.now - state.launchedAt >= timing.stayedMs) {
        return { phase: "stayed", startedAt: state.startedAt, launchedAt: state.launchedAt };
      }
      return state;

    case "status": {
      if (state.phase !== "waiting") return state;
      const launch = { startedAt: state.startedAt, launchedAt: state.launchedAt };
      const attempt = attemptSince(event.snapshot, state.startedAt);
      if (attempt) {
        if (attempt.status === 200) {
          const range = event.snapshot.last_payload_dates;
          return { phase: "synced", ...launch, days: daysInRange(range), range, at: attempt.at };
        }
        return {
          phase: "error",
          ...launch,
          status: attempt.status,
          at: attempt.at,
          ...(attempt.error ? { error: attempt.error } : {}),
        };
      }
      return event.now - state.since >= timing.timeoutMs ? { phase: "timeout", ...launch } : state;
    }

    case "tick":
      if (state.phase === "waiting" && event.now - state.since >= timing.timeoutMs) {
        return { phase: "timeout", startedAt: state.startedAt, launchedAt: state.launchedAt };
      }
      return state;
  }
}
