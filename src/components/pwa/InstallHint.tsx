"use client";

import Link from "next/link";
import { shouldOfferInstall } from "@/lib/pwa/platform";
import { usePlatform } from "@/lib/pwa/usePlatform";

/** Subtle "Install Huddle" link for iOS Safari visitors who haven't added the app to their Home Screen. */
export function InstallHint() {
  const p = usePlatform();
  if (!p || !shouldOfferInstall(p, p.standalone)) return null;
  return (
    <Link
      href="/install"
      className="telemetry mx-auto mt-3 flex h-9 w-fit items-center gap-2 rounded-full px-3.5 text-text-2 shadow-[inset_0_0_0_1px_var(--hairline-strong)] active:bg-white/[0.06]"
    >
      <svg aria-hidden width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3v12M8 7l4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
      </svg>
      Install Huddle
    </Link>
  );
}
