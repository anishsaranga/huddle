/**
 * The group chat's Server-Sent Events stream (GET /api/groups/[id]/stream).
 *
 * Wire format (text/event-stream):
 *   retry: 3000                              reconnect delay for EventSource
 *   id: 42 / event: message / data: {...}    a new message; the SSE id IS the message id
 *   event: reaction / data: {...}            reactions changed on message `id` (no SSE id)
 *   event: delete / data: {...}              message `id` was deleted (no SSE id)
 *   event: reset / data: {}                  too much was missed: reload the latest page
 *   event: ready / data: {}                  replay done, live from here
 *   : ping                                   heartbeat comment every 25 s
 *
 * Only message events carry an SSE id, so the browser's Last-Event-ID is
 * always the newest message it was told about. On (re)connect with
 * `Last-Event-ID` (EventSource sets it) or `?after=<id>` (manual reconnects),
 * the ids of messages after it are replayed from the DB before live events.
 * LISTEN is active before the replay query runs, and live events that arrive
 * meanwhile are held back and then sent without duplicates, so nothing falls
 * in the gap. Payloads are ids only; clients fetch the messages themselves.
 */

import type { Db } from "@/lib/admin/db";
import { childLogger } from "@/lib/log";
import type { ChatHub } from "./hub";
import { messageIdsAfter } from "./service";
import type { GroupEvent } from "./types";

const log = childLogger("chat");

export const SSE_RETRY_MS = 3000;
export const HEARTBEAT_MS = 25_000;
/** More missed messages than this and the client is told to reload instead. */
export const REPLAY_LIMIT = 200;

export type StreamDeps = {
  db: Db;
  hub: Pick<ChatHub, "subscribe">;
  heartbeatMs?: number;
  replayLimit?: number;
};

export type StreamParams = {
  groupId: string;
  userId: string;
  /** Replay messages with id > this (null = live only). */
  lastEventId: number | null;
  /**
   * The client's request: the stream is torn down when its signal aborts.
   * The stream holds on to the Request itself, not just `request.signal`: a
   * Request's signal follows the signal it was built from (Next's
   * response-close signal) through a WeakRef to the Request's internal
   * AbortController, so once the Request is garbage collected the abort never
   * arrives. Holding only the signal leaked the subscriber and heartbeat.
   */
  request?: Request;
};

/** `Last-Event-ID` header, else `?after=`; a non-negative integer (0 = replay everything) or null. */
export function parseLastEventId(request: Request): number | null {
  const raw = request.headers.get("last-event-id") ?? new URL(request.url).searchParams.get("after");
  if (!raw || !/^\d{1,15}$/.test(raw.trim())) return null;
  const n = Number(raw.trim());
  return Number.isSafeInteger(n) ? n : null;
}

export function formatEvent(event: GroupEvent): string {
  const data = JSON.stringify({ type: event.type, id: event.id });
  return `${event.type === "message" ? `id: ${event.id}\n` : ""}event: ${event.type}\ndata: ${data}\n\n`;
}

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  // no-transform: Next's gzip (and any proxy honoring it) must not buffer the stream.
  "Cache-Control": "no-cache, no-store, no-transform",
  // nginx-style proxies: don't buffer.
  "X-Accel-Buffering": "no",
} as const;

/**
 * Teardown is one idempotent, synchronous `close()`, reached from the
 * request's abort, the body's `cancel` (the reader went away), a failed
 * enqueue, or a setup error. It releases the hub subscription (and with the
 * last one, the LISTEN) immediately in whatever phase the stream is: waiting
 * for LISTEN, replaying from the DB, or live. Setup re-checks after each await
 * and stops without sending anything more.
 */
export function openGroupStream(params: StreamParams, deps: StreamDeps): Response {
  const { groupId, userId, lastEventId } = params;
  const heartbeatMs = deps.heartbeatMs ?? HEARTBEAT_MS;
  const replayLimit = deps.replayLimit ?? REPLAY_LIMIT;
  const encoder = new TextEncoder();

  // Strong reference until close (see StreamParams.request).
  let request: Request | null = params.request ?? null;
  const signal = request?.signal ?? null;
  // Aborted on close; the hub releases the subscription on it.
  const lifetime = new AbortController();
  const isClosed = () => lifetime.signal.aborted;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;

  const close = () => {
    if (isClosed()) return;
    lifetime.abort();
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
    signal?.removeEventListener("abort", close);
    request = null;
    try {
      controller?.close();
    } catch {
      // Already closed or errored (client went away).
    }
    log.debug({ groupId, userId }, "chat stream closed");
  };

  const send = (chunk: string) => {
    if (isClosed() || !controller) return;
    try {
      controller.enqueue(encoder.encode(chunk));
    } catch {
      close();
    }
  };

  const run = async () => {
    let live = false;
    const held: GroupEvent[] = [];
    try {
      await deps.hub.subscribe(
        groupId,
        (event) => {
          if (live) send(formatEvent(event));
          else held.push(event);
        },
        lifetime.signal,
      );
      if (isClosed()) return;

      let replayedUpTo = 0;
      if (lastEventId !== null) {
        const ids = await messageIdsAfter(deps.db, groupId, lastEventId, replayLimit + 1);
        if (isClosed()) return;
        if (ids.length > replayLimit) {
          send("event: reset\ndata: {}\n\n");
          replayedUpTo = Number.MAX_SAFE_INTEGER;
        } else {
          for (const id of ids) send(formatEvent({ type: "message", id }));
          replayedUpTo = ids.at(-1) ?? 0;
        }
      }
      for (const event of held) {
        if (event.type === "message" && event.id <= replayedUpTo) continue;
        send(formatEvent(event));
      }
      held.length = 0;
      live = true;
      send("event: ready\ndata: {}\n\n");
      // A failed send above closes the stream: don't start a heartbeat then.
      if (isClosed()) return;
      heartbeat = setInterval(() => send(": ping\n\n"), heartbeatMs);
      log.debug({ groupId, userId, replayFrom: lastEventId }, "chat stream open");
    } catch (err) {
      // Closed mid-setup (subscribe rejects with the abort reason): expected.
      if (isClosed()) return;
      log.error({ groupId, userId, err: err instanceof Error ? err.message : String(err) }, "chat stream failed");
      close();
    }
  };

  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
      send(`retry: ${SSE_RETRY_MS}\n\n`);
    },
    cancel() {
      close();
    },
  });

  if (signal?.aborted) {
    close();
  } else {
    signal?.addEventListener("abort", close, { once: true });
    void run();
  }

  return new Response(body, { headers: SSE_HEADERS });
}
