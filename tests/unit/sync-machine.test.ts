import { describe, expect, it } from "vitest";
import {
  attemptSince,
  daysInRange,
  DEFAULT_SYNC_TIMING,
  IDLE,
  isSettled,
  syncReducer,
  type SyncEvent,
  type SyncSnapshot,
  type SyncState,
} from "@/lib/sync/machine";
import { shortcutRunUrl } from "@/lib/sync/launch";

const T0 = 1_000_000; // client ms at the tap
const STARTED = "2026-09-29T08:00:00.000Z"; // server time at the tap

const snap = (over: Partial<SyncSnapshot> = {}): SyncSnapshot => ({
  last_sync_at: "2026-09-29T07:00:00.000Z",
  last_payload_dates: { from: "2026-09-27", to: "2026-09-29" },
  last_attempt: { at: "2026-09-29T07:00:00.000Z", status: 200, shape: "series" },
  server_time: "2026-09-29T08:00:05.000Z",
  ...over,
});

const run = (events: SyncEvent[], from: SyncState = IDLE) => events.reduce((s, e) => syncReducer(s, e), from);

/** Tap, leave for Shortcuts, come back at T0 + 10 s. */
const LAUNCHED_AND_BACK: SyncEvent[] = [
  { type: "launch", startedAt: STARTED, now: T0 },
  { type: "hidden", now: T0 + 500 },
  { type: "visible", now: T0 + 10_000 },
];

describe("daysInRange", () => {
  it("counts inclusive dates", () => {
    expect(daysInRange({ from: "2026-09-27", to: "2026-09-29" })).toBe(3);
    expect(daysInRange({ from: "2026-09-29", to: "2026-09-29" })).toBe(1);
    expect(daysInRange({ from: "2026-02-27", to: "2026-03-02" })).toBe(4);
    expect(daysInRange({ from: "2026-03-28", to: "2026-03-30" })).toBe(3); // across a DST change (UTC math)
  });
  it("is 0 for missing, inverted or malformed ranges", () => {
    expect(daysInRange(null)).toBe(0);
    expect(daysInRange({ from: "2026-09-29", to: "2026-09-27" })).toBe(0);
    expect(daysInRange({ from: "nope", to: "2026-09-27" })).toBe(0);
  });
});

describe("attemptSince", () => {
  it("only counts attempts strictly after the start (server clock)", () => {
    expect(attemptSince(snap(), STARTED)).toBeNull();
    expect(attemptSince(snap({ last_attempt: { at: STARTED, status: 200, shape: "series" } }), STARTED)).toBeNull();
    const later = { at: "2026-09-29T08:00:03.000Z", status: 400, shape: "series" as const };
    expect(attemptSince(snap({ last_attempt: later }), STARTED)).toEqual(later);
    expect(attemptSince(snap({ last_attempt: null }), STARTED)).toBeNull();
  });
});

describe("syncReducer", () => {
  it("launch → launching (not left yet)", () => {
    expect(run([{ type: "launch", startedAt: STARTED, now: T0 }])).toEqual({
      phase: "launching",
      startedAt: STARTED,
      launchedAt: T0,
      left: false,
    });
  });

  it("waits only after the page was hidden and became visible again", () => {
    const launched = run([{ type: "launch", startedAt: STARTED, now: T0 }]);
    // A focus/pageshow while still on the page changes nothing.
    expect(syncReducer(launched, { type: "visible", now: T0 + 100 })).toBe(launched);
    expect(run(LAUNCHED_AND_BACK)).toEqual({
      phase: "waiting",
      startedAt: STARTED,
      launchedAt: T0,
      since: T0 + 10_000,
      left: false,
    });
  });

  it("stays put while waiting for status without a newer attempt, then times out", () => {
    const waiting = run(LAUNCHED_AND_BACK);
    const old = snap();
    expect(syncReducer(waiting, { type: "status", snapshot: old, now: T0 + 13_000 })).toBe(waiting);
    expect(syncReducer(waiting, { type: "tick", now: T0 + 69_999 })).toBe(waiting);
    expect(syncReducer(waiting, { type: "status", snapshot: old, now: T0 + 70_000 })).toMatchObject({ phase: "timeout" });
    expect(syncReducer(waiting, { type: "tick", now: T0 + 70_000 })).toMatchObject({ phase: "timeout", startedAt: STARTED });
  });

  it("a 200 after the start → synced with the payload's day count", () => {
    const waiting = run(LAUNCHED_AND_BACK);
    const fresh = snap({
      last_attempt: { at: "2026-09-29T08:00:09.000Z", status: 200, shape: "series" },
      last_payload_dates: { from: "2026-09-26", to: "2026-09-29" },
    });
    const s = syncReducer(waiting, { type: "status", snapshot: fresh, now: T0 + 13_000 });
    expect(s).toEqual({
      phase: "synced",
      startedAt: STARTED,
      launchedAt: T0,
      days: 4,
      range: { from: "2026-09-26", to: "2026-09-29" },
      at: "2026-09-29T08:00:09.000Z",
    });
    expect(isSettled(s)).toBe(true);
  });

  it("a 200 without dates → synced with 0 days (no new data)", () => {
    const waiting = run(LAUNCHED_AND_BACK);
    const s = syncReducer(waiting, {
      type: "status",
      snapshot: snap({ last_attempt: { at: "2026-09-29T08:00:09.000Z", status: 200, shape: "series" }, last_payload_dates: null }),
      now: T0 + 13_000,
    });
    expect(s).toMatchObject({ phase: "synced", days: 0, range: null });
  });

  it("a non-200 after the start → error with the server's message", () => {
    const waiting = run(LAUNCHED_AND_BACK);
    const s = syncReducer(waiting, {
      type: "status",
      snapshot: snap({ last_attempt: { at: "2026-09-29T08:00:04.000Z", status: 400, shape: "series", error: "series.steps: bad" } }),
      now: T0 + 13_000,
    });
    expect(s).toEqual({
      phase: "error",
      startedAt: STARTED,
      launchedAt: T0,
      status: 400,
      error: "series.steps: bad",
      at: "2026-09-29T08:00:04.000Z",
    });
    const noMessage = syncReducer(waiting, {
      type: "status",
      snapshot: snap({ last_attempt: { at: "2026-09-29T08:00:04.000Z", status: 429, shape: null } }),
      now: T0 + 13_000,
    });
    expect(noMessage).toMatchObject({ phase: "error", status: 429 });
    expect("error" in noMessage).toBe(false);
  });

  it("ignores status snapshots outside waiting", () => {
    const fresh = snap({ last_attempt: { at: "2026-09-29T08:00:09.000Z", status: 200, shape: "series" } });
    expect(syncReducer(IDLE, { type: "status", snapshot: fresh, now: T0 })).toBe(IDLE);
    const launched = run([{ type: "launch", startedAt: STARTED, now: T0 }]);
    expect(syncReducer(launched, { type: "status", snapshot: fresh, now: T0 })).toBe(launched);
  });

  it("still visible after stayedMs → stayed; a late hide/return still works", () => {
    const launched = run([{ type: "launch", startedAt: STARTED, now: T0 }]);
    expect(syncReducer(launched, { type: "stay-check", now: T0 + 3_999 })).toBe(launched);
    const stayed = syncReducer(launched, { type: "stay-check", now: T0 + DEFAULT_SYNC_TIMING.stayedMs });
    expect(stayed).toEqual({ phase: "stayed", startedAt: STARTED, launchedAt: T0 });
    const back = run(
      [
        { type: "hidden", now: T0 + 6_000 },
        { type: "visible", now: T0 + 12_000 },
      ],
      stayed,
    );
    expect(back).toMatchObject({ phase: "waiting", since: T0 + 12_000 });
    // Once the page has been left, the stay check no longer applies.
    const left = run([{ type: "launch", startedAt: STARTED, now: T0 }, { type: "hidden", now: T0 + 200 }]);
    expect(syncReducer(left, { type: "stay-check", now: T0 + 4_000 })).toBe(left);
  });

  it("going back to Shortcuts while waiting restarts the wait on return", () => {
    const waiting = run(LAUNCHED_AND_BACK);
    const again = run(
      [
        { type: "hidden", now: T0 + 20_000 },
        { type: "visible", now: T0 + 50_000 },
      ],
      waiting,
    );
    expect(again).toMatchObject({ phase: "waiting", since: T0 + 50_000 });
  });

  it("returns later than the resume window → back to idle", () => {
    const s = run([
      { type: "launch", startedAt: STARTED, now: T0 },
      { type: "hidden", now: T0 + 500 },
      { type: "visible", now: T0 + DEFAULT_SYNC_TIMING.resumeWindowMs + 1 },
    ]);
    expect(s).toBe(IDLE);
  });

  it("resume (PWA reloaded on return) starts waiting only within the window", () => {
    expect(run([{ type: "resume", startedAt: STARTED, launchedAt: T0, now: T0 + 30_000 }])).toMatchObject({
      phase: "waiting",
      since: T0 + 30_000,
      startedAt: STARTED,
    });
    expect(run([{ type: "resume", startedAt: STARTED, launchedAt: T0, now: T0 + 5 * 60_000 + 1 }])).toBe(IDLE);
  });

  it("settled states only leave on launch or reset", () => {
    const timeout = syncReducer(run(LAUNCHED_AND_BACK), { type: "tick", now: T0 + 80_000 });
    expect(syncReducer(timeout, { type: "visible", now: T0 + 90_000 })).toBe(timeout);
    expect(syncReducer(timeout, { type: "hidden", now: T0 + 90_000 })).toBe(timeout);
    expect(syncReducer(timeout, { type: "reset" })).toBe(IDLE);
    expect(syncReducer(timeout, { type: "launch", startedAt: STARTED, now: T0 + 90_000 })).toMatchObject({ phase: "launching" });
  });

  it("honours custom timing (test hooks)", () => {
    const timing = { ...DEFAULT_SYNC_TIMING, timeoutMs: 2_000 };
    const waiting = run(LAUNCHED_AND_BACK);
    expect(syncReducer(waiting, { type: "tick", now: T0 + 12_000 }, timing)).toMatchObject({ phase: "timeout" });
  });
});

describe("shortcutRunUrl", () => {
  it("runs the named Shortcut with the force input, without x-callback", () => {
    expect(shortcutRunUrl("Huddle Sync")).toBe("shortcuts://run-shortcut?name=Huddle%20Sync&input=text&text=force");
    expect(shortcutRunUrl("Sync & Go")).toBe("shortcuts://run-shortcut?name=Sync%20%26%20Go&input=text&text=force");
  });
});
