/**
 * In-process fan-out for group events: one LISTEN per group channel, shared by
 * every SSE client in this process.
 *
 * postgres.js runs all `sql.listen()` calls over a single dedicated
 * connection (outside the query pool) and re-issues LISTEN after reconnects,
 * so the process holds one extra Postgres connection however many browsers
 * are connected. The hub keeps an in-memory subscriber set per group: the
 * first subscriber issues LISTEN, the last one to leave UNLISTENs.
 *
 * Single instance by design (like the rate limiter): events from other
 * processes still arrive because they go through Postgres.
 */

import type postgres from "postgres";
import { childLogger } from "@/lib/log";
import { groupChannel } from "./notify";
import { isGroupEvent, type GroupEvent } from "./types";

const log = childLogger("chat");

export type GroupListener = (event: GroupEvent) => void;

type Entry = { listeners: Set<GroupListener>; listen: Promise<postgres.ListenMeta | null> };

type Listenable = Pick<postgres.Sql, "listen">;

export class ChatHub {
  private groups = new Map<string, Entry>();

  constructor(private readonly client: Listenable) {}

  /**
   * Start receiving `groupId`'s events. Resolves once LISTEN is active (so a
   * caller can replay from the DB afterwards without a gap) with the
   * unsubscribe function. Rejects if LISTEN fails.
   *
   * With `signal`, the subscription is released as soon as it aborts, at any
   * point: while LISTEN is still being set up (the promise then rejects with
   * the abort reason) or any time after. Releasing is synchronous and
   * idempotent, whether through the signal or the returned function.
   */
  async subscribe(groupId: string, listener: GroupListener, signal?: AbortSignal): Promise<() => void> {
    signal?.throwIfAborted();
    const channel = groupChannel(groupId);
    let entry = this.groups.get(groupId);
    if (!entry) {
      const listeners = new Set<GroupListener>();
      const listen = this.client
        .listen(channel, (payload) => this.dispatch(groupId, payload))
        .catch((err: unknown) => {
          log.error({ groupId, err: err instanceof Error ? err.message : String(err) }, "listen failed");
          // Forget the entry so the next subscriber retries.
          if (this.groups.get(groupId) === entry) this.groups.delete(groupId);
          throw err;
        });
      entry = { listeners, listen };
      this.groups.set(groupId, entry);
    }
    entry.listeners.add(listener);
    const current = entry;

    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      signal?.removeEventListener("abort", release);
      current.listeners.delete(listener);
      if (current.listeners.size === 0 && this.groups.get(groupId) === current) {
        this.groups.delete(groupId);
        // Still pending is fine: UNLISTEN runs once LISTEN has gone through.
        current.listen.then((meta) => meta?.unlisten()).catch(() => {});
      }
    };
    signal?.addEventListener("abort", release, { once: true });

    try {
      await current.listen;
    } catch (err) {
      release();
      throw err;
    }
    // Aborted while LISTEN was pending: `release` already ran.
    signal?.throwIfAborted();
    return release;
  }

  /** Subscribers for a group in this process (tests / diagnostics). */
  subscriberCount(groupId: string): number {
    return this.groups.get(groupId)?.listeners.size ?? 0;
  }

  private dispatch(groupId: string, payload: string): void {
    let event: unknown;
    try {
      event = JSON.parse(payload);
    } catch {
      event = null;
    }
    if (!isGroupEvent(event)) {
      log.warn({ groupId }, "ignored malformed group event");
      return;
    }
    const clean: GroupEvent = { type: event.type, id: event.id };
    for (const fn of this.groups.get(groupId)?.listeners ?? []) {
      try {
        fn(clean);
      } catch (err) {
        log.error({ groupId, err: err instanceof Error ? err.message : String(err) }, "group listener threw");
      }
    }
  }
}

const globalForHub = globalThis as unknown as { __huddleChatHub?: ChatHub };

/** The process-wide hub over the app's postgres.js client (cached on globalThis for dev HMR). */
export async function getChatHub(): Promise<ChatHub> {
  if (!globalForHub.__huddleChatHub) {
    const { sql } = await import("@/db");
    globalForHub.__huddleChatHub = new ChatHub(sql);
  }
  return globalForHub.__huddleChatHub;
}

/** Drop the cached hub (tests that close and reopen the pool). */
export function resetChatHub(): void {
  globalForHub.__huddleChatHub = undefined;
}
