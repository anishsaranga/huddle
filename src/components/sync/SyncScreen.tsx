"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { AmbientGlow } from "@/components/ui/AmbientGlow";
import { Button } from "@/components/ui/Button";
import { Stagger, StaggerItem } from "@/components/ui/Stagger";
import type { SyncStatusResponse } from "@/lib/sync-status";
import { describeAttemptError } from "@/lib/sync/attempt";
import type { SyncState } from "@/lib/sync/machine";
import { alpha, NEUTRAL_SIGNAL, SIGNAL } from "@/lib/ui/colors";
import { formatRelative } from "@/lib/ui/format";
import { ease } from "@/lib/ui/motion";
import { ArrowIcon, compactAge, formatDateRange, LinkButton, SyncIcon, useNow } from "./bits";
import { SyncOrb, type OrbMode } from "./SyncOrb";
import { useSyncNow } from "./useSyncNow";

type SyncScreenProps = {
  initial: SyncStatusResponse;
  /** The user has an active API key. */
  hasKey: boolean;
  /** SHORTCUT_NAME: the Shortcut that Sync now runs. */
  shortcutName: string;
  /** Server render time (ms), for hydration-stable relative times. */
  renderedAt: number;
};

type Readout = { kicker: string; value: ReactNode; unit: string };

type View = {
  mode: OrbMode;
  color: string;
  readout: Readout;
  headline: string;
  body: ReactNode;
  actions: ReactNode;
  detail?: ReactNode;
};

const CheckGlyph = () => (
  <svg aria-hidden width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
    <motion.path d="m5 12.5 4.2 4.2L19 7" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.45, delay: 0.1, ease: ease.out }} />
  </svg>
);

const PhoneGlyph = () => (
  <svg aria-hidden width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <rect x="6.5" y="2.5" width="11" height="19" rx="2.6" />
    <path d="M10.5 5h3" />
  </svg>
);

function mmss(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Red telemetry banner with the server's error line. */
function ErrorLine({ status, error }: { status: number; error?: string }) {
  return (
    <div
      role="note"
      className="rounded-xl px-3.5 py-3 text-left"
      style={{ background: alpha(SIGNAL.red, 8), boxShadow: `inset 0 0 0 1px ${alpha(SIGNAL.red, 26)}` }}
    >
      <p className="telemetry" style={{ color: SIGNAL.red }}>
        {`// HTTP ${status}`}
      </p>
      {error && (
        <p data-testid="sync-error" className="mt-1.5 font-mono text-[12px] leading-snug text-text-2 [overflow-wrap:anywhere]">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Sync tab: the orb, "Sync now" and what the last sync did. Before the
 * Shortcut is set up it steers to /setup instead (no key → create one; key
 * but never synced → set up the Shortcut, with "run it" as a secondary).
 */
export function SyncScreen({ initial, hasKey, shortcutName, renderedAt }: SyncScreenProps) {
  const { state, snapshot, launch, reset } = useSyncNow(shortcutName, initial);
  const now = useNow(renderedAt, state.phase === "waiting" ? 1_000 : 15_000);
  const setup: "no-key" | "never" | "ready" = !hasKey ? "no-key" : snapshot.last_sync_at ? "ready" : "never";
  const view = buildView({ state, snapshot, setup, now, launch, reset, shortcutName });

  const lastAttempt = snapshot.last_attempt;
  const attemptOk = lastAttempt?.status === 200;

  return (
    <div className="relative isolate min-h-full">
      <AmbientGlow color={view.color} intensity={view.mode === "dormant" ? 0.45 : 0.8} />

      <header className="pt-safe px-safe">
        <div className="flex items-end justify-between gap-4 px-5 pb-2 pt-6">
          <div>
            <p className="telemetry mb-2">Apple Health · {shortcutName}</p>
            <h1 className="font-display text-[40px] font-bold uppercase leading-[0.9] tracking-[0.02em]">Sync</h1>
          </div>
          <Link
            href="/setup"
            className="telemetry mb-1 inline-flex h-8 items-center gap-1.5 rounded-full bg-white/[0.03] px-3 text-text-2 shadow-[inset_0_0_0_1px_var(--hairline-strong)] active:bg-white/[0.06]"
          >
            Setup guide
          </Link>
        </div>
      </header>

      <Stagger className="px-4" delay={0.05}>
        <StaggerItem className="pt-4">
          <SyncOrb mode={view.mode} color={view.color} burstKey={state.phase === "synced" ? state.at : undefined}>
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.div
                key={`${view.readout.kicker}-${typeof view.readout.value === "string" ? "t" : "g"}`}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.25, ease: ease.out }}
                className="flex flex-col items-center"
              >
                <p className="telemetry text-[9.5px]" style={{ color: view.mode === "dormant" ? undefined : view.color }}>
                  {view.readout.kicker}
                </p>
                <div
                  data-testid="orb-value"
                  className="num mt-1.5 flex min-h-[46px] items-center font-display text-[50px] font-semibold uppercase leading-none tracking-[0.01em]"
                  style={{ color: view.mode === "burst" ? view.color : undefined }}
                >
                  {view.readout.value}
                </div>
                <p className="telemetry mt-1.5 text-[9.5px] text-text-2">{view.readout.unit}</p>
              </motion.div>
            </AnimatePresence>
          </SyncOrb>
        </StaggerItem>

        <StaggerItem className="pt-6 text-center">
          <div aria-live="polite" data-testid="sync-state" data-phase={state.phase} data-setup={setup}>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={view.headline}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.22, ease: ease.out }}
              >
                <h2 className="font-display text-[30px] font-bold uppercase leading-[0.95] tracking-[0.02em]">{view.headline}</h2>
                <div className="mx-auto mt-2.5 max-w-[34ch] text-[15px] leading-relaxed text-muted">{view.body}</div>
                {view.detail && <div className="mx-auto mt-4 max-w-[360px]">{view.detail}</div>}
              </motion.div>
            </AnimatePresence>
          </div>
        </StaggerItem>

        <StaggerItem className="pt-6">
          <div className="space-y-2">{view.actions}</div>
        </StaggerItem>

        <StaggerItem className="pt-6">
          <dl className="surface grid grid-cols-3 divide-x divide-hairline py-4">
            <Stat label="Days covered">
              <span data-testid="days-covered">{snapshot.days_covered}</span>
            </Stat>
            <Stat label="Last window">
              {snapshot.last_payload_dates
                ? formatDateRange(snapshot.last_payload_dates.from, snapshot.last_payload_dates.to)
                : "—"}
            </Stat>
            <Stat label="Last attempt">
              {lastAttempt ? (
                <span className="inline-flex items-center gap-1.5" data-testid="last-attempt">
                  <span
                    aria-hidden
                    className="size-1.5 rounded-full"
                    style={{
                      background: attemptOk ? SIGNAL.green : SIGNAL.red,
                      boxShadow: `0 0 6px ${attemptOk ? SIGNAL.green : SIGNAL.red}`,
                    }}
                  />
                  <span style={attemptOk ? undefined : { color: SIGNAL.red }}>{lastAttempt.status}</span>
                  <span className="text-muted" suppressHydrationWarning>
                    · {shortAge(new Date(lastAttempt.at), now)}
                  </span>
                </span>
              ) : (
                "—"
              )}
            </Stat>
          </dl>
        </StaggerItem>

        {setup === "ready" && (
          <StaggerItem className="pt-3">
            <Link
              href="/setup#automate"
              className="surface flex items-center gap-3.5 px-5 py-4 transition-colors active:bg-white/[0.03]"
            >
              <span
                aria-hidden
                className="grid size-9 shrink-0 place-items-center rounded-full"
                style={{ color: SIGNAL.strain, background: alpha(SIGNAL.strain, 12), boxShadow: `inset 0 0 0 1px ${alpha(SIGNAL.strain, 30)}` }}
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M13 2 4 14h7l-1 8 9-12h-7z" />
                </svg>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-medium leading-tight">Syncs on its own</span>
                <span className="mt-0.5 block text-[13px] leading-snug text-muted">
                  With the automation, opening Instagram or WhatsApp keeps Huddle fresh.
                </span>
              </span>
              <span className="shrink-0 text-dim">
                <ArrowIcon />
              </span>
            </Link>
          </StaggerItem>
        )}
      </Stagger>
    </div>
  );
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 px-3 text-center">
      <dt className="telemetry truncate text-[9.5px]">{label}</dt>
      <dd className="num mt-1.5 truncate text-[15px] font-semibold text-text">{children}</dd>
    </div>
  );
}

function shortAge(at: Date, now: number): string {
  const rel = formatRelative(at, new Date(now));
  return rel.replace(" ago", "").replace("Just now", "now").replace(" min", "m").replace(" h", "h").replace(" days", "d");
}

function buildView({
  state,
  snapshot,
  setup,
  now,
  launch,
  reset,
  shortcutName,
}: {
  state: SyncState;
  snapshot: SyncStatusResponse;
  setup: "no-key" | "never" | "ready";
  now: number;
  launch: () => void;
  reset: () => void;
  shortcutName: string;
}): View {
  const syncNow = (label = "Sync now", variant: "signal" | "secondary" = "signal") => (
    <Button
      variant={variant}
      color={SIGNAL.strain}
      size="lg"
      fullWidth
      onClick={launch}
      icon={<SyncIcon />}
    >
      {label}
    </Button>
  );
  const quote = <span className="text-text-2">&ldquo;{shortcutName}&rdquo;</span>;

  switch (state.phase) {
    case "launching":
      return {
        mode: "busy",
        color: SIGNAL.strain,
        readout: { kicker: "Status", value: <SyncIcon size={34} className="animate-spin-fast [animation-duration:1.6s]" />, unit: "Opening Shortcuts" },
        headline: "Opening Shortcuts…",
        body: <>Huddle runs {quote} for you. When it finishes, swipe back to Huddle.</>,
        actions: (
          <Button variant="ghost" size="md" fullWidth onClick={reset}>
            Cancel
          </Button>
        ),
      };
    case "stayed":
      return {
        mode: "alert",
        color: SIGNAL.yellow,
        readout: { kicker: "Not here", value: <PhoneGlyph />, unit: "iPhone only" },
        headline: "Open this on your iPhone",
        body: (
          <>
            Sync now runs the {quote} Shortcut, which lives on your iPhone. Open Huddle from your iPhone&rsquo;s Home Screen and
            tap Sync now there.
          </>
        ),
        actions: (
          <>
            {syncNow("Try again", "secondary")}
            <Button variant="ghost" size="md" fullWidth onClick={reset}>
              Cancel
            </Button>
          </>
        ),
      };
    case "waiting":
      return {
        mode: "busy",
        color: SIGNAL.strain,
        readout: { kicker: "Listening", value: mmss(now - state.since), unit: "for your Shortcut" },
        headline: "Waiting for your Shortcut…",
        body: <>This usually takes a few seconds. Keep Huddle open.</>,
        actions: (
          <Button variant="ghost" size="md" fullWidth onClick={reset}>
            Cancel
          </Button>
        ),
      };
    case "synced": {
      const nothing = state.days === 0;
      return {
        mode: "burst",
        color: SIGNAL.green,
        readout: nothing
          ? { kicker: "Synced", value: <CheckGlyph />, unit: "up to date" }
          : { kicker: "Synced", value: `+${state.days}`, unit: state.days === 1 ? "day updated" : "days updated" },
        headline: nothing ? "No new data" : "Synced",
        body: nothing ? (
          <>Your Shortcut ran, but Health had nothing new to send.</>
        ) : (
          <>
            {state.days} {state.days === 1 ? "day" : "days"} updated
            {state.range ? <> · {formatDateRange(state.range.from, state.range.to)}</> : null}. Your scores are fresh.
          </>
        ),
        actions: (
          <>
            <LinkButton href="/home" variant="primary" iconAfter={<ArrowIcon />}>
              See today
            </LinkButton>
            <Button variant="ghost" size="md" fullWidth onClick={reset}>
              Done
            </Button>
          </>
        ),
      };
    }
    case "error":
      return {
        mode: "alert",
        color: SIGNAL.red,
        readout: { kicker: "Error", value: String(state.status), unit: "sync failed" },
        headline: "Sync failed",
        body: <>{describeAttemptError(state)}</>,
        detail: <ErrorLine status={state.status} error={state.error} />,
        actions: (
          <>
            <LinkButton href="/setup#troubleshooting" variant="primary">
              Troubleshoot
            </LinkButton>
            {syncNow("Try again", "secondary")}
          </>
        ),
      };
    case "timeout":
      return {
        mode: "alert",
        color: SIGNAL.yellow,
        readout: { kicker: "No signal", value: "—", unit: "nothing arrived" },
        headline: "Didn’t hear from your Shortcut",
        body: (
          <>
            Check it&rsquo;s named exactly {quote}, that Health access is on, and that your phone stayed unlocked.
          </>
        ),
        actions: (
          <>
            <LinkButton href="/setup#troubleshooting" variant="primary">
              Open setup guide
            </LinkButton>
            {syncNow("Try again", "secondary")}
          </>
        ),
      };
    case "idle":
      break;
  }

  // Idle: depends on how far setup got.
  if (setup === "no-key") {
    return {
      mode: "dormant",
      color: NEUTRAL_SIGNAL,
      readout: { kicker: "Last sync", value: "—", unit: "no sync key" },
      headline: "Create your sync key",
      body: <>Your iPhone Shortcut needs a personal key before it can send your Health data.</>,
      actions: (
        <LinkButton href="/setup" variant="signal" color={SIGNAL.strain} iconAfter={<ArrowIcon />}>
          Set up sync
        </LinkButton>
      ),
    };
  }
  if (setup === "never") {
    return {
      mode: "dormant",
      color: NEUTRAL_SIGNAL,
      readout: { kicker: "Last sync", value: "—", unit: "never synced" },
      headline: "Set up the Shortcut first",
      body: <>Add {quote} to your iPhone, then run it once. About five minutes with the install link.</>,
      detail: snapshot.last_attempt && snapshot.last_attempt.status !== 200 && (
        <ErrorLine status={snapshot.last_attempt.status} error={snapshot.last_attempt.error} />
      ),
      actions: (
        <>
          <LinkButton href="/setup" variant="signal" color={SIGNAL.strain} iconAfter={<ArrowIcon />}>
            Open setup guide
          </LinkButton>
          {syncNow("I’ve installed it — run it", "secondary")}
        </>
      ),
    };
  }

  const at = new Date(snapshot.last_sync_at!);
  const age = compactAge(at, now);
  const lastFailed = snapshot.last_attempt && snapshot.last_attempt.status !== 200 && Date.parse(snapshot.last_attempt.at) > at.getTime();
  return {
    mode: "calm",
    color: lastFailed ? SIGNAL.red : SIGNAL.strain,
    readout: { kicker: "Last sync", value: age.value, unit: age.unit },
    headline: lastFailed ? "Last sync failed" : "Ready to sync",
    body: lastFailed ? (
      <>{describeAttemptError(snapshot.last_attempt!)}</>
    ) : (
      <>Pull the latest from Apple Health. It takes a few seconds in Shortcuts.</>
    ),
    detail: lastFailed ? <ErrorLine status={snapshot.last_attempt!.status} error={snapshot.last_attempt!.error} /> : undefined,
    actions: syncNow(),
  };
}
