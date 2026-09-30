"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { isGroupEvent, type GroupEvent } from "@/lib/chat/types";

export type StreamHandlers = {
  /** Newest message id this client has (the replay point for manual reconnects). */
  lastId: () => number;
  onEvent: (event: GroupEvent) => void;
  /** Too much was missed: reload the latest page. */
  onReset: () => void;
  /** A connection is live again after a drop: resync what replay can't (reactions, deletes). */
  onResync: () => void;
};

const MAX_BACKOFF_MS = 30_000;

/**
 * Live group events over EventSource. The browser reconnects by itself after
 * network blips (sending Last-Event-ID); on top of that the stream is closed
 * while the page is hidden (iOS kills background connections anyway) and
 * reopened with `?after=<last id>` when it's visible again or the device
 * comes back online. A stream the server refused (401/404/5xx) is retried
 * with backoff while visible.
 */
export function useGroupStream(groupId: string, handlers: StreamHandlers) {
  const ref = useRef(handlers);
  useLayoutEffect(() => {
    ref.current = handlers;
  });

  useEffect(() => {
    let es: EventSource | null = null;
    let everReady = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let backoff = 2000;
    let disposed = false;

    const close = () => {
      if (retry) clearTimeout(retry);
      retry = null;
      es?.close();
      es = null;
    };

    const connect = () => {
      if (disposed) return;
      close();
      // Always pass the replay point (0 = everything), so nothing sent between the page render
      // and LISTEN becoming active is missed.
      const source = new EventSource(`/api/groups/${groupId}/stream?after=${ref.current.lastId()}`);
      es = source;
      const relay = (e: MessageEvent<string>) => {
        let data: unknown;
        try {
          data = JSON.parse(e.data);
        } catch {
          return;
        }
        if (isGroupEvent(data)) ref.current.onEvent(data);
      };
      source.addEventListener("message", relay);
      source.addEventListener("reaction", relay);
      source.addEventListener("delete", relay);
      source.addEventListener("reset", () => ref.current.onReset());
      source.addEventListener("ready", () => {
        backoff = 2000;
        if (everReady) ref.current.onResync();
        everReady = true;
      });
      source.onerror = () => {
        // CONNECTING = the browser is retrying on its own; CLOSED = it gave up (HTTP error).
        if (source.readyState !== EventSource.CLOSED || es !== source) return;
        es = null;
        if (document.visibilityState !== "visible") return;
        retry = setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
      };
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") connect();
      else close();
    };
    const onOnline = () => connect();

    connect();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    return () => {
      disposed = true;
      close();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
    };
  }, [groupId]);
}
