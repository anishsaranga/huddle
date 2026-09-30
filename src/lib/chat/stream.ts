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
  /** The request's signal: the stream is torn down when the client goes away. */
  signal?: AbortSignal;
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

export function openGroupStream(params: StreamParams, deps: StreamDeps): Response {
  const { groupId, userId, lastEventId, signal } = params;
  const heartbeatMs = deps.heartbeatMs ?? HEARTBEAT_MS;
  const replayLimit = deps.replayLimit ?? REPLAY_LIMIT;
  const encoder = new TextEncoder();

  let closed = false;
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    unsubscribe?.();
    signal?.removeEventListener("abort", cleanup);
    try {
      controllerRef?.close();
    } catch {
      // Already closed or errored (client went away).
    }
    log.debug({ groupId, userId }, "chat stream closed");
  };

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      controllerRef = controller;
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };

      send(`retry: ${SSE_RETRY_MS}\n\n`);
      if (signal?.aborted) return cleanup();
      signal?.addEventListener("abort", cleanup);

      let live = false;
      const held: GroupEvent[] = [];
      try {
        const off = await deps.hub.subscribe(groupId, (event) => {
          if (live) send(formatEvent(event));
          else held.push(event);
        });
        if (closed) return off();
        unsubscribe = off;

        let replayedUpTo = 0;
        if (lastEventId !== null) {
          const ids = await messageIdsAfter(deps.db, groupId, lastEventId, replayLimit + 1);
          if (closed) return;
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
        heartbeat = setInterval(() => send(": ping\n\n"), heartbeatMs);
        log.debug({ groupId, userId, replayFrom: lastEventId }, "chat stream open");
      } catch (err) {
        log.error({ groupId, userId, err: err instanceof Error ? err.message : String(err) }, "chat stream failed");
        cleanup();
      }
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(body, { headers: SSE_HEADERS });
}
