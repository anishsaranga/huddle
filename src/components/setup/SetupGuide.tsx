"use client";

import { motion, useReducedMotion } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";
import { AmbientGlow } from "@/components/ui/AmbientGlow";
import { Stagger, StaggerItem } from "@/components/ui/Stagger";
import type { KeyStatusDTO } from "@/lib/apikey-actions";
import type { SyncStatusResponse } from "@/lib/sync-status";
import { describeAttemptError } from "@/lib/sync/attempt";
import { alpha, SIGNAL } from "@/lib/ui/colors";
import { formatRelative } from "@/lib/ui/format";
import { spring } from "@/lib/ui/motion";
import { ConnectionCard } from "./ConnectionCard";
import { Act, Collapsible, CopyChip, F, L, Rail, SectionTitle, Tip, Toggle, V } from "./primitives";
import { Recipe } from "./Recipe";

type SetupGuideProps = {
  ingestUrl: string;
  keyStatus: KeyStatusDTO;
  initialStatus: SyncStatusResponse;
  /** Successful syncs on 2+ days this week: the automation works. */
  automated: boolean;
  shortcutName: string;
  icloudUrl: string | null;
  renderedAt: number;
};

const LIVE_POLL_MS = 10_000;

/** Poll sync-status while the page is visible, so a test run shows up live. */
function useLiveStatus(initial: SyncStatusResponse): SyncStatusResponse {
  const [status, setStatus] = useState(initial);
  useEffect(() => {
    let stopped = false;
    const load = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/me/sync-status", { cache: "no-store" });
        if (res.ok && !stopped) setStatus((await res.json()) as SyncStatusResponse);
      } catch {
        // offline: keep the last one
      }
    };
    const id = window.setInterval(load, LIVE_POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return status;
}

type StageState = "done" | "current" | "todo";

const STAGE_ICONS: Record<string, ReactNode> = {
  install: (
    <path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19.5h14" />
  ),
  health: (
    <path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10Z" />
  ),
  automate: <path d="M13 2.5 4.5 13.5h6.5l-1 8 8.5-11h-6.5z" />,
};

function Stage({ id, label, state, index }: { id: string; label: string; state: StageState; index: number }) {
  const reduced = useReducedMotion();
  const color = state === "done" ? SIGNAL.green : state === "current" ? SIGNAL.strain : "var(--dim)";
  return (
    <li className="relative flex flex-1 flex-col items-center" data-stage={id} data-state={state}>
      <motion.span
        className="relative grid size-12 place-items-center rounded-full"
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ ...spring.bouncy, delay: 0.15 + index * 0.1 }}
        style={{
          color: state === "done" ? "var(--bg)" : color,
          background: state === "done" ? SIGNAL.green : state === "current" ? alpha(SIGNAL.strain, 12) : "var(--card-sunken)",
          boxShadow:
            state === "done"
              ? `0 0 18px ${alpha(SIGNAL.green, 45)}`
              : `inset 0 0 0 1.5px ${state === "current" ? alpha(SIGNAL.strain, 70) : "var(--hairline-strong)"}`,
        }}
      >
        {state === "current" && !reduced && (
          <span aria-hidden className="animate-dot-pulse absolute inset-0 rounded-full" style={{ boxShadow: `0 0 0 1.5px ${SIGNAL.strain}` }} />
        )}
        <svg aria-hidden width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {state === "done" ? <path d="m5 12.5 4.2 4.2L19 7" /> : STAGE_ICONS[id]}
        </svg>
      </motion.span>
      <span className="telemetry mt-2.5 text-center text-[9.5px]" style={{ color: state === "todo" ? undefined : color }}>
        {label}
      </span>
      <span className="sr-only">{state === "done" ? "done" : state === "current" ? "next" : "to do"}</span>
    </li>
  );
}

function Connector({ lit }: { lit: boolean }) {
  return (
    <li aria-hidden className="mt-6 h-px flex-[0.6] self-start" style={{ background: lit ? `linear-gradient(90deg, ${SIGNAL.green}, ${alpha(SIGNAL.green, 30)})` : "var(--hairline-strong)" }} />
  );
}

/** Live telemetry strip: listening / last sync / last failure. */
function LiveStrip({ status, now }: { status: SyncStatusResponse; now: number }) {
  const a = status.last_attempt;
  if (a && a.status !== 200) {
    return (
      <div
        role="alert"
        data-testid="setup-error"
        className="rounded-2xl px-4 py-3.5"
        style={{ background: alpha(SIGNAL.red, 9), boxShadow: `inset 0 0 0 1px ${alpha(SIGNAL.red, 30)}` }}
      >
        <p className="telemetry flex items-center gap-2" style={{ color: SIGNAL.red }}>
          <span aria-hidden className="size-1.5 rounded-full" style={{ background: SIGNAL.red, boxShadow: `0 0 8px ${SIGNAL.red}` }} />
          <span>
            Last sync failed · HTTP {a.status} · <span suppressHydrationWarning>{formatRelative(new Date(a.at), new Date(now)).toLowerCase()}</span>
          </span>
        </p>
        <p className="mt-2 text-[14px] leading-snug text-text">{describeAttemptError(a)}</p>
        {a.error && <p className="mt-1.5 font-mono text-[12px] leading-snug text-text-2 [overflow-wrap:anywhere]">{a.error}</p>}
        <a href="#troubleshooting" className="telemetry mt-2.5 inline-block text-text-2 underline decoration-dotted underline-offset-4">
          Troubleshooting →
        </a>
      </div>
    );
  }
  const synced = status.last_sync_at;
  const color = synced ? SIGNAL.green : SIGNAL.strain;
  return (
    <div
      className="flex items-center gap-2.5 rounded-2xl px-4 py-3"
      style={{ background: alpha(color, 6), boxShadow: `inset 0 0 0 1px ${alpha(color, 20)}` }}
      data-testid="setup-live"
    >
      <span aria-hidden className="relative inline-block size-[7px] shrink-0">
        {!synced && <span className="animate-dot-pulse absolute inset-0 rounded-full" style={{ background: color }} />}
        <span className="absolute inset-0 rounded-full" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
      </span>
      <p className="telemetry min-w-0 truncate" style={{ color }}>
        {synced ? (
          <span suppressHydrationWarning>
            Last sync {formatRelative(new Date(synced), new Date(now)).toLowerCase()} · {status.days_covered} days
          </span>
        ) : (
          "Listening for your first sync"
        )}
      </p>
    </div>
  );
}

function NumberedList({ items }: { items: ReactNode[] }) {
  return (
    <ol className="space-y-3">
      {items.map((item, i) => (
        <li key={i} className="flex gap-3">
          <span className="num mt-[1px] grid size-6 shrink-0 place-items-center rounded-full bg-white/[0.06] font-mono text-[11px] text-text-2 shadow-[inset_0_0_0_1px_var(--hairline-strong)]">
            {i + 1}
          </span>
          <span className="min-w-0 flex-1 text-[14.5px] leading-relaxed text-text-2">{item}</span>
        </li>
      ))}
    </ol>
  );
}

function Trouble({ title, children, defaultOpen, id }: { title: string; children: ReactNode; defaultOpen?: boolean; id?: string }) {
  return (
    <Collapsible
      id={id}
      defaultOpen={defaultOpen}
      className="px-5 py-4"
      header={<span className="block text-[15px] font-medium leading-snug text-text">{title}</span>}
    >
      <div className="pt-2.5 text-[14px] leading-relaxed text-muted">{children}</div>
    </Collapsible>
  );
}

const Kbd = ({ children }: { children: ReactNode }) => <span className="text-text-2">{children}</span>;

/**
 * /setup: connect the iPhone. Hero with live progress, the user's URL and key,
 * Option A (iCloud install link) / Option B (build it yourself, step by step),
 * automation, backfill and troubleshooting.
 */
export function SetupGuide({ ingestUrl, keyStatus, initialStatus, automated, shortcutName, icloudUrl, renderedAt }: SetupGuideProps) {
  const status = useLiveStatus(initialStatus);
  const [keyState, setKeyState] = useState(keyStatus);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [now, setNow] = useState(renderedAt);
  useEffect(() => {
    const first = window.setTimeout(() => setNow(Date.now()), 0);
    const id = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, []);

  const installed = Boolean(status.last_sync_at || status.last_attempt);
  const health = Boolean(status.last_sync_at && status.days_covered > 0);
  const flags = [installed, health, automated];
  const firstOpen = flags.indexOf(false);
  const stageState = (i: number): StageState => (flags[i] ? "done" : i === firstOpen ? "current" : "todo");
  const lastStatus = status.last_attempt?.status;

  const nameChip = <CopyChip value={shortcutName} label="Shortcut name" />;

  return (
    <div className="relative isolate min-h-full">
      <AmbientGlow color={SIGNAL.strain} intensity={0.7} />

      <header className="pt-safe px-safe">
        <div className="px-5 pb-2 pt-6">
          <p className="telemetry">{"Sync setup · iPhone Shortcut"}</p>
          <h1 className="mt-2 font-display text-[46px] font-bold uppercase leading-[0.88] tracking-[0.01em]">
            Connect your
            <br />
            iPhone
          </h1>
          <p className="mt-3 max-w-[34ch] text-[15px] leading-relaxed text-muted">
            A Shortcut on your iPhone reads Apple Health and sends it to Huddle. Set it up once; after that it syncs
            whenever you open your everyday apps.
          </p>
        </div>
      </header>

      <Stagger className="px-4" delay={0.05}>
        <StaggerItem className="pt-5">
          <ol className="flex items-start px-1" aria-label="Setup progress">
            <Stage id="install" label="Install" state={stageState(0)} index={0} />
            <Connector lit={flags[0]} />
            <Stage id="health" label="Allow Health" state={stageState(1)} index={1} />
            <Connector lit={flags[1]} />
            <Stage id="automate" label="Automate" state={stageState(2)} index={2} />
          </ol>
        </StaggerItem>

        <StaggerItem className="pt-6">
          <LiveStrip status={status} now={now} />
        </StaggerItem>

        <StaggerItem className="pt-3">
          <ConnectionCard
            ingestUrl={ingestUrl}
            status={keyState}
            onStatus={setKeyState}
            revealed={revealed}
            onRevealed={setRevealed}
          />
        </StaggerItem>

        {/* Option A */}
        <StaggerItem as="section" id="install" className="scroll-mt-4">
          <SectionTitle kicker="// Option A · Recommended" title="Install in one tap" color={SIGNAL.strain} />
          {icloudUrl ? (
            <div className="surface surface-elevated p-5">
              <motion.a
                href={icloudUrl}
                target="_blank"
                rel="noopener noreferrer"
                whileTap={{ scale: 0.97 }}
                transition={spring.press}
                data-testid="icloud-install"
                className="flex h-[56px] w-full items-center justify-center gap-2.5 rounded-full text-[14px] font-semibold uppercase tracking-[0.12em] text-bg"
                style={{ background: SIGNAL.strain, boxShadow: `0 0 0 1px ${alpha(SIGNAL.strain, 60)} inset, 0 10px 30px -10px ${alpha(SIGNAL.strain, 80)}` }}
              >
                <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19.5h14" />
                </svg>
                Get {shortcutName}
              </motion.a>
              <div className="mt-5">
                <NumberedList
                  items={[
                    <>
                      Tap <Kbd>Get {shortcutName}</Kbd>, then <Kbd>Add Shortcut</Kbd>. Keep its name.
                    </>,
                    <>
                      When it asks, paste your URL <CopyChip value={ingestUrl} label="Ingest URL" /> and your key
                      {revealed ? (
                        <>
                          {" "}
                          <CopyChip value={revealed} label="Key" />
                        </>
                      ) : (
                        <> from the card above (use Show a new key to get a copyable one)</>
                      )}
                    </>,
                    <>Run it once from the Shortcuts app and allow Health access.</>,
                  ]}
                />
              </div>
            </div>
          ) : (
            <div className="surface p-5" data-testid="icloud-missing">
              <p className="telemetry" style={{ color: SIGNAL.yellow }}>
                {"// Link not published yet"}
              </p>
              <p className="mt-2 text-[15px] leading-relaxed text-text-2">
                Your Huddle admin hasn&rsquo;t shared the one-tap install link yet.
              </p>
              <p className="mt-1.5 text-[14px] leading-relaxed text-muted">
                Build it yourself below: about 15 minutes, once. Or ask your admin for the link.
              </p>
            </div>
          )}
        </StaggerItem>

        {/* Option B */}
        <StaggerItem as="section" id="build" className="scroll-mt-4">
          <SectionTitle kicker="// Option B" title="Build it yourself">
            Every action and field of {shortcutName}, in order. It sends one compact request with your last few days.
          </SectionTitle>
          <Recipe ingestUrl={ingestUrl} apiKey={revealed} keyHint={keyState.active ? keyState.prefixHint : null} shortcutName={shortcutName} />
        </StaggerItem>

        {/* Health access */}
        <StaggerItem as="section" id="health" className="scroll-mt-4">
          <SectionTitle kicker="// Health access" title="Allow Health" />
          <div className="surface p-5">
            <NumberedList
              items={[
                <>The first run asks for access to each Health type: tap <Kbd>Allow</Kbd> (or <Kbd>Turn On All</Kbd>).</>,
                <>
                  Missed it? <Kbd>Settings → Health → Data Access &amp; Devices → Shortcuts → Turn On All</Kbd>.
                </>,
              ]}
            />
            <Tip>
              Health data is encrypted while your iPhone is locked, so no Shortcut can read it on a timer at 6 am. Opening an
              app means the phone is unlocked: that&rsquo;s why Huddle syncs then.
            </Tip>
          </div>
        </StaggerItem>

        {/* Automation */}
        <StaggerItem as="section" id="automate" className="scroll-mt-4">
          <SectionTitle kicker="// Automate it" title="Sync on its own">
            Run {shortcutName} whenever you open an app you use every day. The 45-minute throttle keeps it light.
          </SectionTitle>
          <div className="surface p-5">
            <NumberedList
              items={[
                <>
                  Shortcuts → <Kbd>Automation</Kbd> tab → <Kbd>+</Kbd>.
                </>,
                <>
                  Choose <Kbd>App</Kbd>, then pick 3–5 apps you open often: Instagram, WhatsApp, Safari…
                </>,
                <>
                  Tick <Kbd>Is Opened</Kbd> (leave Is Closed off).
                </>,
                <>
                  Choose <Kbd>Run Immediately</Kbd> and turn off <Kbd>Notify When Run</Kbd>.
                </>,
                <>
                  Next → add <ActionName>Run Shortcut</ActionName> → pick {nameChip}.
                </>,
              ]}
            />
            <Tip>Older iOS versions call it “Ask Before Running”: turn that off instead.</Tip>
          </div>
        </StaggerItem>

        {/* Backfill */}
        <StaggerItem as="section" id="backfill" className="scroll-mt-4">
          <SectionTitle kicker="// Optional · Run once" title="Backfill a year">
            A second Shortcut that sends up to a year of history in 30-day chunks, so your baselines are ready on day one.
          </SectionTitle>
          <div className="surface p-5">
            <Collapsible
              header={
                <span className="block">
                  <span className="block text-[16px] font-semibold leading-tight">Huddle Backfill</span>
                  <span className="mt-1 block text-[13px] text-muted">Duplicate Huddle Sync and change a few steps</span>
                </span>
              }
            >
              <div className="pt-4">
                <Rail>
                  <Act name="Duplicate → rename">
                    <F k="Name">
                      <L>Huddle Backfill</L>
                    </F>
                    <F k="Delete">
                      steps <L>02</L> <L>03</L> <L>10</L>
                    </F>
                  </Act>
                  <Act name="Ask for Input">
                    <F k="Type · Prompt">
                      <L>Number</L> <L>How many days?</L>
                    </F>
                    <F k="Default">
                      <L>365</L> → Set Variable <V>DaysTotal</V>
                    </F>
                  </Act>
                  <Act name="Calculate · Round Number">
                    <F k="">
                      <V>DaysTotal</V> <L>÷</L> <L>30</L>, round <L>Always Round Up</L> → <V>Chunks</V>
                    </F>
                  </Act>
                  <Act name="Repeat">
                    <F k="">
                      <V>Chunks</V> times
                    </F>
                  </Act>
                  <Act name="Calculate" depth={1}>
                    <F k="">
                      (<V>Repeat Index</V> <L>−</L> <L>1</L>) <L>×</L> <L>30</L> → <V>Offset</V>
                    </F>
                  </Act>
                  <Act name="Adjust Date ×2" depth={1}>
                    <F k="">
                      <V>Current Date</V> <L>Subtract</L> <V>Offset</V> days, <L>Get Start of Day</L> → <V>ToDay</V>
                    </F>
                  </Act>
                  <Act name="Adjust Date" depth={1}>
                    <F k="">
                      <V>ToDay</V> <L>Add</L> <L>1 day</L> → <V>ToEnd</V>
                    </F>
                  </Act>
                  <Act name="Adjust Date" depth={1}>
                    <F k="">
                      <V>ToDay</V> <L>Subtract</L> <L>29 days</L> → <V>FromDate</V>
                    </F>
                  </Act>
                  <Act name="Format Date ×2" depth={1}>
                    <F k="">
                      <L>yyyy-MM-dd</L>: <V>FromDate</V> → <V>FromText</V>, <V>ToDay</V> → <V>ToText</V>
                    </F>
                  </Act>
                  <Act name="Steps 04–07" depth={1}>
                    <F k="Filter">
                      <L>Start Date is between</L> <V>FromDate</V> and <V>ToEnd</V>
                    </F>
                    <F k="Sleep">
                      between <V>SleepFrom</V> and <V>ToEnd</V>
                    </F>
                  </Act>
                  <Act name="Steps 08–09" depth={1}>
                    <F k="window.to">
                      <V>ToText</V> <span className="text-[12px] text-muted">(instead of TodayText)</span>
                    </F>
                  </Act>
                  <Act name="End Repeat" end />
                  <Act name="Show Notification">
                    <F k="">
                      <L>Huddle backfill done:</L> <V>Chunks</V> <L>× 30 days</L>
                    </F>
                  </Act>
                </Rail>
                <Tip>
                  Run it once, after {shortcutName} works, with the phone unlocked and Shortcuts open. A year is 13 requests
                  of about 150 KB and takes a minute or two.
                </Tip>
                <Tip tone="warning">Keep it to 365 days or fewer: Huddle doesn&rsquo;t accept dates older than 400 days.</Tip>
              </div>
            </Collapsible>
          </div>
        </StaggerItem>

        {/* Troubleshooting */}
        <StaggerItem as="section" id="troubleshooting" className="scroll-mt-4">
          <SectionTitle kicker="// Troubleshooting" title="Not working?" />
          <div className="surface divide-y divide-hairline overflow-hidden">
            <Trouble title="Nothing is syncing">
              <ul className="list-disc space-y-1.5 pl-4">
                <li>
                  The Shortcut must be named exactly {nameChip} (Sync now and the automation run it by name).
                </li>
                <li>
                  Health access: <Kbd>Settings → Health → Data Access &amp; Devices → Shortcuts → Turn On All</Kbd>.
                </li>
                <li>The phone must be unlocked: Health can&rsquo;t be read while it&rsquo;s locked.</li>
                <li>
                  The automation should be set to <Kbd>Run Immediately</Kbd>. Run the Shortcut by hand in Shortcuts to see
                  any error it shows.
                </li>
              </ul>
            </Trouble>
            <Trouble title="It says 401 (Unauthorized)" defaultOpen={false}>
              Your key was replaced or revoked, or it&rsquo;s pasted incompletely. Use <Kbd>Show a new key</Kbd> above and
              paste it into the <V>HuddleKey</V> text. The header must read <L>Bearer</L>, a space, then the key.
            </Trouble>
            <Trouble title="It says 400 (Bad request)" defaultOpen={lastStatus === 400} id="trouble-400">
              {status.last_attempt?.status === 400 && status.last_attempt.error && (
                <span className="mb-2.5 block rounded-lg px-3 py-2" style={{ background: alpha(SIGNAL.red, 8), boxShadow: `inset 0 0 0 1px ${alpha(SIGNAL.red, 24)}` }}>
                  <span className="telemetry block" style={{ color: SIGNAL.red }}>
                    Huddle&rsquo;s last answer
                  </span>
                  <span data-testid="trouble-400-error" className="mt-1 block font-mono text-[12px] leading-snug text-text-2 [overflow-wrap:anywhere]">
                    {status.last_attempt.error}
                  </span>
                </span>
              )}
              Huddle didn&rsquo;t like the data. Usually a <V>_starts</V> and <V>_values</V> pair came from different blocks
              (their line counts differ), a Combine Text isn&rsquo;t set to <L>New Lines</L>, or a Format Date isn&rsquo;t
              ISO 8601. The error names the series and line.
            </Trouble>
            <Trouble title="Dates look wrong or aren’t in English">
              Set every <ActionName>Format Date</ActionName> to <L>ISO 8601</L> with <Kbd>Include ISO 8601 Time</Kbd>{" "}
              <Toggle on />. Otherwise iOS formats dates in your phone&rsquo;s language, which Huddle can&rsquo;t read.
            </Trouble>
            <Trouble title="Steps look doubled (iPhone + band)">
              Health usually removes the overlap, but if your totals look too high, add a <L>Source is</L> filter (your
              band&rsquo;s app) to the Steps, Distance and Energy <ActionName>Find Health Samples</ActionName>.
            </Trouble>
            <Trouble title="It says 429 (Too many requests)">
              More than 60 syncs in an hour. Check the throttle (step 02): <V>last_run_at</V> must be saved on every run.
            </Trouble>
          </div>
        </StaggerItem>

        <StaggerItem>
          <p className="telemetry px-2 pb-2 pt-6 text-center text-[9.5px] text-dim">
            Huddle only receives what the Shortcut sends. Your key is stored scrambled.
          </p>
        </StaggerItem>
      </Stagger>
    </div>
  );
}

function ActionName({ children }: { children: ReactNode }) {
  return <span className="font-mono text-[13px] text-text">{children}</span>;
}
