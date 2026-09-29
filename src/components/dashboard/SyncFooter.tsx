"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { SIGNAL } from "@/lib/ui/colors";
import { formatRelative } from "@/lib/ui/format";

const HOUR = 3_600_000;

/**
 * "Synced 12 min ago" (ticks every 30 s) and a Sync link. The first render
 * uses the server's clock (`renderedAt`) so hydration matches; the live
 * clock takes over after mount. The dot says how fresh the data is.
 */
export function SyncFooter({ lastSyncAt, renderedAt }: { lastSyncAt: string | null; renderedAt: number }) {
  const [now, setNow] = useState(renderedAt);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = window.setTimeout(tick, 0);
    const id = window.setInterval(tick, 30_000);
    const onVisible = () => document.visibilityState === "visible" && tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const at = lastSyncAt ? new Date(lastSyncAt) : null;
  const age = at ? now - at.getTime() : Infinity;
  const dot = age < 6 * HOUR ? SIGNAL.green : age < 30 * HOUR ? SIGNAL.yellow : SIGNAL.red;
  const rel = at ? formatRelative(at, new Date(now)) : "";
  const text = at ? `Synced ${/^(Just now|Yesterday)$/.test(rel) ? rel.toLowerCase() : rel}` : "Never synced";

  return (
    <div className="flex items-center justify-between gap-3">
      <span className="telemetry flex min-w-0 items-center gap-2" aria-live="polite">
        <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: dot, boxShadow: `0 0 6px ${dot}` }} />
        <span className="truncate">{text}</span>
      </span>
      <Link
        href="/sync"
        className="inline-flex h-9 shrink-0 select-none items-center justify-center gap-1.5 rounded-full bg-white/[0.03] px-3.5 text-[12px] font-semibold uppercase tracking-[0.12em] text-text shadow-[inset_0_0_0_1px_var(--hairline-strong),inset_0_1px_0_rgb(255_255_255/0.06)] transition-transform active:scale-[0.97]"
      >
        <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 11a8 8 0 0 0-14-4.5L4 9" />
          <path d="M4 4v5h5" />
          <path d="M4 13a8 8 0 0 0 14 4.5L20 15" />
          <path d="M20 20v-5h-5" />
        </svg>
        Sync
      </Link>
    </div>
  );
}
