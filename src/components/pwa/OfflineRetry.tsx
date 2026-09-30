"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * "Try again" is a plain link (full page load, so the service worker gets a
 * fresh navigation); it also fires by itself when the browser reports the
 * network is back.
 */
export function OfflineRetry() {
  const router = useRouter();
  useEffect(() => {
    const onOnline = () => router.replace("/home");
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [router]);

  return (
    <a
      href="/home"
      className="relative flex h-[52px] w-full select-none items-center justify-center rounded-full bg-white text-[14px] font-semibold uppercase tracking-[0.12em] text-bg shadow-[0_1px_0_rgb(255_255_255/0.4)_inset,0_6px_20px_-8px_rgb(255_255_255/0.35)] active:opacity-80"
    >
      Try again
    </a>
  );
}
