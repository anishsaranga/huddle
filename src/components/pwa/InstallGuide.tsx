"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { AmbientGlow } from "@/components/ui/AmbientGlow";
import { Stagger, StaggerItem } from "@/components/ui/Stagger";
import { usePlatform } from "@/lib/pwa/usePlatform";
import { alpha, SIGNAL } from "@/lib/ui/colors";
import { HomeScreenMock, ShareButtonMock, ShareGlyph, ShareSheetMock } from "./InstallMocks";

const STEPS: { n: string; color: string; title: ReactNode; body: ReactNode; mock: ReactNode }[] = [
  {
    n: "01",
    color: SIGNAL.strain,
    title: "Tap Share",
    body: (
      <>
        In Safari, tap the Share button (the square with an arrow, <ShareGlyph size={14} className="-mt-0.5 inline text-text-2" />) in the
        toolbar.
      </>
    ),
    mock: <ShareButtonMock />,
  },
  {
    n: "02",
    color: SIGNAL.green,
    title: "Add to Home Screen",
    body: <>Scroll the sheet, tap Add to Home Screen, then Add. Keep the name Huddle.</>,
    mock: <ShareSheetMock />,
  },
  {
    n: "03",
    color: SIGNAL.sleep,
    title: "Open it from your Home Screen",
    body: <>Launch Huddle from its new icon. It opens full screen, like an app. You&rsquo;ll sign in once more inside it.</>,
    mock: <HomeScreenMock />,
  },
];

function Notice({ tone, title, children }: { tone: string; title: string; children: ReactNode }) {
  return (
    <div
      role="note"
      className="surface mb-5 px-4 py-3.5"
      style={{ boxShadow: `inset 3px 0 0 ${tone}` }}
      data-testid="install-notice"
    >
      <p className="text-[15px] font-semibold leading-tight">{title}</p>
      <div className="mt-1 text-[14px] leading-snug text-muted">{children}</div>
    </div>
  );
}

function CopyLink() {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <button
      type="button"
      className="telemetry mt-3 inline-flex h-9 items-center rounded-full px-3.5 text-text-2 shadow-[inset_0_0_0_1px_var(--hairline-strong)] active:bg-white/[0.06]"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(`${window.location.origin}/install`);
          setState("copied");
        } catch {
          setState("failed");
        }
      }}
    >
      {state === "copied" ? "Link copied" : state === "failed" ? "Copy failed" : "Copy link"}
    </button>
  );
}

/** The /install screen: platform notice, three illustrated steps, the "sign in again" caveat. */
export function InstallGuide() {
  const router = useRouter();
  const platform = usePlatform();

  // Already running from the Home Screen: nothing to install.
  useEffect(() => {
    if (platform?.standalone) router.replace("/home");
  }, [platform?.standalone, router]);

  return (
    <>
      <AmbientGlow color={SIGNAL.green} intensity={0.7} />

      <Stagger className="flex flex-1 flex-col pb-10" delay={0.05} stagger={0.08}>
        <StaggerItem className="flex items-center justify-between pt-5">
          <Link href="/login" className="telemetry -ml-2 inline-flex h-9 items-center gap-1 px-2 text-text-2 active:opacity-60">
            <svg aria-hidden width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="m10 3.5-4.5 4.5L10 12.5" />
            </svg>
            Sign in
          </Link>
          <span className="telemetry text-dim">Install</span>
        </StaggerItem>

        <StaggerItem className="pb-6 pt-8">
          <p className="telemetry mb-3">Use Safari on iPhone</p>
          <h1 className="font-display text-[56px] font-bold uppercase leading-[0.88] tracking-[0.01em]">
            Add Huddle to your Home Screen
          </h1>
          <p className="mt-4 max-w-[30ch] text-[16px] leading-snug text-text-2">
            Three taps and it lives next to your other apps: full screen, no browser bars, one tap from your scores.
          </p>
        </StaggerItem>

        {platform && !platform.isIOS && (
          <StaggerItem>
            <Notice tone={SIGNAL.yellow} title="Open this on your iPhone in Safari">
              Home Screen install works from Safari on iPhone. Send yourself this link and open it there.
              <br />
              <CopyLink />
            </Notice>
          </StaggerItem>
        )}
        {platform?.isIOS && !platform.isSafari && (
          <StaggerItem>
            <Notice tone={SIGNAL.yellow} title="Open this page in Safari">
              This browser can&rsquo;t add Huddle to your Home Screen reliably. Copy the link, open Safari, and paste it there.
              <br />
              <CopyLink />
            </Notice>
          </StaggerItem>
        )}

        {STEPS.map((s) => (
          <StaggerItem key={s.n} className="mb-3">
            <section className="surface p-4" aria-label={`Step ${s.n}`}>
              {s.mock}
              <div className="flex items-start gap-3.5">
                <span
                  aria-hidden
                  className="font-display text-[34px] font-bold leading-[0.85]"
                  style={{ color: s.color }}
                >
                  {s.n}
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="font-display text-[26px] font-bold uppercase leading-[0.95] tracking-[0.02em]">{s.title}</h2>
                  <p className="mt-1.5 text-[14.5px] leading-snug text-muted">{s.body}</p>
                </div>
              </div>
            </section>
          </StaggerItem>
        ))}

        <StaggerItem className="mt-2">
          <div
            className="rounded-xl px-4 py-3.5 text-[13.5px] leading-snug text-muted"
            style={{ background: alpha(SIGNAL.strain, 7), boxShadow: `inset 0 0 0 1px ${alpha(SIGNAL.strain, 20)}` }}
          >
            The installed app keeps its own sign-in, separate from Safari, so choose Continue with Google once more the first time
            you open it.
          </div>
          <Link
            href="/login"
            className="mt-2 flex h-11 items-center justify-center text-[13px] font-semibold uppercase tracking-[0.12em] text-text-2 active:opacity-60"
          >
            Back to sign in
          </Link>
        </StaggerItem>
      </Stagger>
    </>
  );
}
