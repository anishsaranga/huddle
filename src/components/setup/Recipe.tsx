"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import type { DeviceId } from "@/lib/sync/recipe";
import { alpha, SIGNAL } from "@/lib/ui/colors";
import { ease, spring } from "@/lib/ui/motion";
import { AdviceBadge, DevicePicker, extraAdvice, MetricTable } from "./DevicePicker";
import { Act, Chevron, CopyChip, F, Kbd, L, Rail, Tip, Toggle, V } from "./primitives";

type RecipeProps = {
  ingestUrl: string;
  /** The plaintext key when it was just created on this page, else null. */
  apiKey: string | null;
  /** `gk_abcd` hint of the active key (null = no key). */
  keyHint: string | null;
  shortcutName: string;
};

type Step = { id: string; n: string; title: string; summary: string; body: ReactNode };

const DONE_KEY = "huddle:setup-done";
const DEVICE_KEY = "huddle:setup-device";

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage disabled: progress just isn't remembered
  }
}

const Check = () => (
  <svg aria-hidden width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="m4.5 10.5 3.6 3.6 7.4-8" />
  </svg>
);

/** The per-metric block, shown once as a template. */
function MetricBlock({ group }: { group: "day" | "none" }) {
  return (
    <Rail>
      <Act name="Find Health Samples">
        <F k="Type is">
          <L>Steps</L>
          <span className="text-[12px] text-muted">(then each metric below)</span>
        </F>
        <F k="Start Date is after">
          <V>FromDate</V>
        </F>
        <F k="Sort by">
          <L>Start Date</L> <L>Oldest First</L>
        </F>
        <F k="Group By">{group === "day" ? <L>Day</L> : <L>None</L>}</F>
        <F k="Unit">
          <L>count</L>
          <span className="text-[12px] text-muted">(the unit in the list)</span>
        </F>
        <F k="Limit">
          <Toggle on={false} />
        </F>
      </Act>
      <Act name="Get Details of Health Samples">
        <F k="Get">
          <L>Value</L>
        </F>
      </Act>
      <Act name="Combine Text">
        <F k="with">
          <L>New Lines</L>
        </F>
      </Act>
      <Act name="Set Variable">
        <F k="Name">
          <V>steps_values</V>
          <span className="text-[12px] text-muted">(key + _values)</span>
        </F>
      </Act>
      <Act name="Get Details of Health Samples">
        <F k="Get">
          <L>Start Date</L>
        </F>
        <F k="of">
          <V>Health Samples</V>
          <span className="text-[12px] text-muted">(tap the input, pick the Find result)</span>
        </F>
      </Act>
      <Act name="Format Date">
        <F k="Date Format">
          <L>ISO 8601</L>
        </F>
        <F k="Include ISO 8601 Time">
          <Toggle on />
        </F>
      </Act>
      <Act name="Combine Text">
        <F k="with">
          <L>New Lines</L>
        </F>
      </Act>
      <Act name="Set Variable">
        <F k="Name">
          <V>steps_starts</V>
          <span className="text-[12px] text-muted">(key + _starts)</span>
        </F>
      </Act>
    </Rail>
  );
}

function buildSteps({ ingestUrl, apiKey, keyHint, shortcutName, device }: RecipeProps & { device: DeviceId }): Step[] {
  const keyValue = apiKey ? (
    <CopyChip value={apiKey} label="Key" testId="recipe-key" />
  ) : keyHint ? (
    <>
      <L>
        {keyHint}
        <span className="text-dim">••••</span>
      </L>
      <span className="text-[12px] text-muted">
        (use <a href="#connection" className="text-text-2 underline decoration-dotted underline-offset-2">Show a new key</a> to copy it)
      </span>
    </>
  ) : (
    <span className="text-[12px] text-muted">
      <a href="#connection" className="text-text-2 underline decoration-dotted underline-offset-2">Create a key</a> first
    </span>
  );
  const hr = extraAdvice("hr", device);

  return [
    {
      id: "create",
      n: "00",
      title: "Create the Shortcut",
      summary: `A new Shortcut named exactly “${shortcutName}”`,
      body: (
        <>
          <Rail>
            <Act name="Shortcuts app → +">
              <F k="Name">
                <CopyChip value={shortcutName} label="Shortcut name" />
              </F>
            </Act>
            <Act name="Receive input (top of the editor)">
              <F k="Receive">
                <L>Text</L>
              </F>
              <F k="If there’s no input">
                <L>Continue</L>
              </F>
            </Act>
          </Rail>
          <Tip>
            The name must match exactly: Sync now runs the Shortcut by name. Receiving Text lets Sync now pass{" "}
            <L>force</L> to skip the 45-minute throttle. On some iOS versions this block only appears after you tap ⓘ and
            turn on <span className="text-text-2">Show in Share Sheet</span>.
          </Tip>
        </>
      ),
    },
    {
      id: "vars",
      n: "01",
      title: "Your URL and key",
      summary: "Two Text actions, saved as HuddleURL and HuddleKey",
      body: (
        <>
          <Rail>
            <Act name="Text">
              <F k="Paste">
                <CopyChip value={ingestUrl} label="Ingest URL" testId="recipe-url" />
              </F>
            </Act>
            <Act name="Set Variable">
              <F k="Name">
                <V>HuddleURL</V>
              </F>
            </Act>
            <Act name="Text">
              <F k="Paste">{keyValue}</F>
            </Act>
            <Act name="Set Variable">
              <F k="Name">
                <V>HuddleKey</V>
              </F>
            </Act>
          </Rail>
          <Tip>
            In the iCloud version these two are Import Questions: it asks for them when you add it. After a new key, only
            the HuddleKey text changes.
          </Tip>
          <Tip>
            Admin, before sharing: open the Shortcut&rsquo;s details (ⓘ) → <Kbd>Import Questions</Kbd> and add a question for each of
            the <V>HuddleURL</V> and <V>HuddleKey</V> Text actions, so every friend is asked for their own URL and key when they
            install it.
          </Tip>
        </>
      ),
    },
    {
      id: "throttle",
      n: "02",
      title: "Throttle",
      summary: "Stop if it already ran in the last 45 minutes",
      body: (
        <>
          <Rail>
            <Act name="Get File">
              <F k="From">
                <L>Shortcuts</L> folder
              </F>
              <F k="Path">
                <L>Huddle/state.json</L>
              </F>
              <F k="Error If Not Found">
                <Toggle on={false} />
              </F>
            </Act>
            <Act name="If">
              <F k="">
                <V>File</V> <L>has any value</L>
              </F>
            </Act>
            <Act name="Get Dictionary from Input" depth={1}>
              <F k="Input">
                <V>File</V> → Set Variable <V>State</V>
              </F>
            </Act>
            <Act name="Get Dictionary Value" depth={1}>
              <F k="Key">
                <L>last_run_at</L> in <V>State</V>
              </F>
            </Act>
            <Act name="Get Time Between Dates" depth={1}>
              <F k="Between">
                <V>Dictionary Value</V> and <V>Current Date</V>
              </F>
              <F k="In">
                <L>Minutes</L>
              </F>
            </Act>
            <Act name="If" depth={1}>
              <F k="">
                <V>Time Between Dates</V> <L>is less than</L> <L>45</L>
              </F>
            </Act>
            <Act name="If" depth={2}>
              <F k="">
                <V>Shortcut Input</V> <L>is not</L> <L>force</L>
              </F>
            </Act>
            <Act name="Stop This Shortcut" depth={3} />
            <Act name="End If · End If · End If" end />
          </Rail>
          <Tip>
            Opening Instagram five times an hour shouldn&rsquo;t sync five times. Sync now sends <L>force</L>, so it always
            runs.
          </Tip>
        </>
      ),
    },
    {
      id: "window",
      n: "03",
      title: "Window",
      summary: "2 days back, or back to the last success (max 14 days)",
      body: (
        <>
          <Rail>
            <Act name="Number">
              <F k="">
                <L>2</L> → Set Variable <V>DaysBack</V>
              </F>
            </Act>
            <Act name="Get Dictionary Value">
              <F k="Key">
                <L>last_success_date</L> in <V>State</V>
              </F>
            </Act>
            <Act name="If">
              <F k="">
                <V>Dictionary Value</V> <L>has any value</L>
              </F>
            </Act>
            <Act name="Get Time Between Dates" depth={1}>
              <F k="Between">
                <V>Dictionary Value</V> and <V>Current Date</V> in <L>Days</L>
              </F>
            </Act>
            <Act name="Calculate" depth={1}>
              <F k="">
                <V>Time Between Dates</V> <L>+</L> <L>1</L> → Set Variable <V>DaysBack</V>
              </F>
            </Act>
            <Act name="If · Number · Set Variable" depth={1}>
              <F k="">
                <V>DaysBack</V> <L>is greater than</L> <L>13</L> → <L>13</L> → <V>DaysBack</V>
              </F>
            </Act>
            <Act name="If · Number · Set Variable" depth={1}>
              <F k="">
                <V>DaysBack</V> <L>is less than</L> <L>2</L> → <L>2</L> → <V>DaysBack</V>
              </F>
            </Act>
            <Act name="End If" end />
            <Act name="Adjust Date">
              <F k="">
                <L>Subtract</L> <V>DaysBack</V> <L>days</L> from <V>Current Date</V>
              </F>
            </Act>
            <Act name="Adjust Date">
              <F k="">
                <L>Get Start of Day</L> of <V>Adjusted Date</V> → Set Variable <V>FromDate</V>
              </F>
            </Act>
            <Act name="Format Date">
              <F k="">
                <V>FromDate</V>, Custom <L>yyyy-MM-dd</L> → Set Variable <V>FromText</V>
              </F>
            </Act>
            <Act name="Format Date">
              <F k="">
                <V>Current Date</V>, Custom <L>yyyy-MM-dd</L> → Set Variable <V>TodayText</V>
              </F>
            </Act>
          </Rail>
          <Tip>
            Normally 3 days (today and two before), which also catches late writes from Zepp and Fitbit. If the phone sat
            unused for a week, the next run automatically reaches back to fill the gap.
          </Tip>
        </>
      ),
    },
    {
      id: "totals",
      n: "04",
      title: "Daily totals",
      summary: "One block per metric, Group By Day",
      body: (
        <>
          <p className="mb-3 text-[14px] leading-relaxed text-muted">
            Build this block for Steps, then duplicate it for every metric you keep. In each copy change the Type, the Unit
            and the two variable names: <V>distance_m_values</V> and <V>distance_m_starts</V>, and so on.
          </p>
          <MetricBlock group="day" />
          <div className="mt-4">
            <MetricTable kind="cumulative" device={device} />
          </div>
          <Tip>
            Select the eight actions of a finished block, then Duplicate: much faster than adding each action again.
          </Tip>
        </>
      ),
    },
    {
      id: "measures",
      n: "05",
      title: "Measurements",
      summary: "Same block without grouping: the server averages each day",
      body: (
        <>
          <p className="mb-3 text-[14px] leading-relaxed text-muted">
            Same eight actions, but <span className="text-text-2">Group By: None</span>. Skip the ones your device
            doesn&rsquo;t record: an empty one just costs a second.
          </p>
          <MetricTable kind="discrete" device={device} />
        </>
      ),
    },
    {
      id: "hr",
      n: "06",
      title: "Heart rate by hour",
      summary: "Heart Rate, Group By Hour",
      body: (
        <>
          <div className="mb-3 flex items-center gap-2">
            <span className="text-[14px] text-muted">For your device:</span>
            <AdviceBadge advice={hr} />
          </div>
          <Rail>
            <Act name="Find Health Samples">
              <F k="Type is">
                <L>Heart Rate</L>
              </F>
              <F k="Start Date is after">
                <V>FromDate</V>
              </F>
              <F k="Sort · Group By">
                <L>Start Date, Oldest First</L> <L>Hour</L>
              </F>
              <F k="Unit">
                <L>count/min</L>
              </F>
              <F k="Limit">
                <Toggle on={false} />
              </F>
            </Act>
            <Act name="Get Details → Combine Text">
              <F k="Value">
                → <V>hr_avg</V>
              </F>
              <F k="Start Date → Format Date ISO 8601">
                → <V>hr_starts</V>
              </F>
            </Act>
          </Rail>
          <Tip>Grouped by hour, each value is that hour&rsquo;s average: 24 numbers a day instead of about 1,400.</Tip>
        </>
      ),
    },
    {
      id: "sleep",
      n: "07",
      title: "Sleep",
      summary: "Every sleep sample since 6 pm the evening before",
      body: (
        <>
          <Rail>
            <Act name="Adjust Date">
              <F k="">
                <L>Subtract</L> <L>6 hours</L> from <V>FromDate</V> → Set Variable <V>SleepFrom</V>
              </F>
            </Act>
            <Act name="Find Health Samples">
              <F k="Type is">
                <L>Sleep Analysis</L>
              </F>
              <F k="Start Date is after">
                <V>SleepFrom</V>
              </F>
              <F k="Sort by">
                <L>Start Date, Oldest First</L>
              </F>
              <F k="Group By · Limit">
                <L>None</L> <Toggle on={false} />
              </F>
            </Act>
            <Act name="Get Details → Combine Text (×4)">
              <F k="Value">
                → <V>sleep_stages</V>
              </F>
              <F k="Start Date → Format Date ISO 8601">
                → <V>sleep_starts</V>
              </F>
              <F k="End Date → Format Date ISO 8601">
                → <V>sleep_ends</V>
              </F>
              <F k="Source">
                → <V>sleep_sources</V>
              </F>
            </Act>
          </Rail>
          <Tip>Sleep is sent raw (stages with times) so Huddle can build each night and pick your best source.</Tip>
        </>
      ),
    },
    {
      id: "payload",
      n: "08",
      title: "Build the payload",
      summary: "One Dictionary with nested dictionaries",
      body: (
        <>
          <Rail>
            <Act name="Dictionary">
              <F k="Then">
                Set Variable <V>Payload</V>
              </F>
            </Act>
          </Rail>
          <PayloadTree />
          <Tip>
            In the Dictionary action, add a field, choose <span className="text-text-2">Dictionary</span> as its type, and
            add fields inside it. Leave out metrics you skipped.
          </Tip>
        </>
      ),
    },
    {
      id: "send",
      n: "09",
      title: "Send it",
      summary: "POST to your Huddle URL with your key",
      body: (
        <>
          <Rail>
            <Act name="Get Contents of URL">
              <F k="URL">
                <V>HuddleURL</V>
              </F>
              <F k="Method">
                <L>POST</L>
              </F>
              <F k="Header">
                <L>Authorization</L> = <L>Bearer␣</L>
                <V>HuddleKey</V>
              </F>
              <F k="Header">
                <L>Content-Type</L> = <L>application/json</L>
              </F>
              <F k="Request Body">
                <L>JSON</L> → <V>Payload</V>
              </F>
            </Act>
          </Rail>
          <Tip>
            Type <L>Bearer</L>, a space, then insert the <V>HuddleKey</V> variable. If your iOS version won&rsquo;t take
            the whole Payload as the JSON body, set Request Body to <L>File</L> and pick <V>Payload</V>: a dictionary is
            sent as JSON either way.
          </Tip>
        </>
      ),
    },
    {
      id: "state",
      n: "10",
      title: "Remember the run",
      summary: "Save last_run_at, and last_success_date on success",
      body: (
        <>
          <Rail>
            <Act name="Get Dictionary Value">
              <F k="Key">
                <L>ok</L> in <V>Contents of URL</V>
              </F>
            </Act>
            <Act name="If">
              <F k="">
                <V>Dictionary Value</V> <L>has any value</L>
              </F>
            </Act>
            <Act name="Set Variable" depth={1}>
              <F k="">
                <V>TodayText</V> → <V>LastSuccess</V>
              </F>
            </Act>
            <Act name="Otherwise" end />
            <Act name="Get Dictionary Value · Set Variable" depth={1}>
              <F k="">
                <L>last_success_date</L> in <V>State</V> → <V>LastSuccess</V>
              </F>
            </Act>
            <Act name="End If" end />
            <Act name="Format Date">
              <F k="">
                <V>Current Date</V>, <L>ISO 8601</L>, time <Toggle on />
              </F>
            </Act>
            <Act name="Dictionary">
              <F k="last_run_at">
                <V>Formatted Date</V>
              </F>
              <F k="last_success_date">
                <V>LastSuccess</V>
              </F>
            </Act>
            <Act name="Save File">
              <F k="Destination">
                <L>Shortcuts</L> / <L>Huddle/state.json</L>
              </F>
              <F k="Ask Where to Save">
                <Toggle on={false} />
              </F>
              <F k="Overwrite If File Exists">
                <Toggle on />
              </F>
            </Act>
          </Rail>
          <Tip>
            last_run_at is saved on every run (that&rsquo;s the throttle); last_success_date only moves when Huddle answered{" "}
            <L>ok</L>, so a failed day is re-sent next time.
          </Tip>
          <Tip>
            Now tap ▶ to run it once. iOS asks for Health access the first time: allow everything. Then open the Sync tab
            to check it arrived.
          </Tip>
        </>
      ),
    },
  ];
}

/** Indented key tree of the Payload dictionary. */
function PayloadTree() {
  const rows: [number, string, ReactNode][] = [
    [0, "window", <L key="d">Dictionary</L>],
    [1, "from", <V key="v">FromText</V>],
    [1, "to", <V key="v">TodayText</V>],
    [0, "series", <L key="d">Dictionary</L>],
    [1, "steps", <L key="d">Dictionary</L>],
    [2, "starts", <V key="v">steps_starts</V>],
    [2, "values", <V key="v">steps_values</V>],
    [1, "distance_m …", <span key="n" className="text-[12px] text-muted">same, one per metric you kept</span>],
    [0, "hr", <L key="d">Dictionary</L>],
    [1, "starts", <V key="v">hr_starts</V>],
    [1, "avg", <V key="v">hr_avg</V>],
    [0, "sleep_segments", <L key="d">Dictionary</L>],
    [1, "stages", <V key="v">sleep_stages</V>],
    [1, "starts", <V key="v">sleep_starts</V>],
    [1, "ends", <V key="v">sleep_ends</V>],
    [1, "sources", <V key="v">sleep_sources</V>],
    [0, "meta", <L key="d">Dictionary</L>],
    [1, "shortcut_version", <L key="t">1</L>],
  ];
  return (
    <div className="mt-2 overflow-hidden rounded-xl bg-card-sunken py-2 shadow-[inset_0_1px_2px_rgb(0_0_0/0.5),inset_0_0_0_1px_var(--hairline)]">
      {rows.map(([depth, key, value], i) => (
        <div key={i} className="flex items-center gap-2 py-[3px] pr-3" style={{ paddingLeft: 12 + depth * 16 }}>
          {depth > 0 && <span aria-hidden className="font-mono text-[11px] text-dim">└</span>}
          <span className="min-w-0 font-mono text-[12px] text-text">{key}</span>
          <span className="ml-auto shrink-0">{value}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Option B: the whole Huddle Sync recipe as a numbered checklist. One step is
 * open at a time; "Done" ticks it and opens the next. Progress and the device
 * pick are remembered on this device.
 */
export function Recipe(props: RecipeProps) {
  const [device, setDevice] = useState<DeviceId>("apple-watch");
  const [done, setDone] = useState<string[]>([]);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    // Restore after mount (localStorage isn't available during SSR).
    const d = readJson<DeviceId | null>(DEVICE_KEY, null);
    const saved = readJson<string[]>(DONE_KEY, []);
    const t = window.setTimeout(() => {
      if (d) setDevice(d);
      if (Array.isArray(saved)) setDone(saved);
    }, 0);
    return () => window.clearTimeout(t);
  }, []);

  const steps = buildSteps({ ...props, device });
  const pickDevice = (d: DeviceId) => {
    setDevice(d);
    writeJson(DEVICE_KEY, d);
  };
  const markDone = (id: string) => {
    const next = done.includes(id) ? done : [...done, id];
    setDone(next);
    writeJson(DONE_KEY, next);
    const i = steps.findIndex((s) => s.id === id);
    const after = steps.slice(i + 1).find((s) => !next.includes(s.id));
    setOpen(after?.id ?? null);
    if (after) {
      window.setTimeout(() => document.getElementById(`step-${after.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
    }
  };
  const toggleDone = (id: string) => {
    const next = done.includes(id) ? done.filter((x) => x !== id) : [...done, id];
    setDone(next);
    writeJson(DONE_KEY, next);
  };

  return (
    <div>
      <div className="surface p-5">
        <p className="telemetry">{"// What do you wear?"}</p>
        <p className="mb-3 mt-1.5 text-[14px] leading-snug text-muted">
          Huddle marks the Health blocks your device fills, so you can skip the rest.
        </p>
        <DevicePicker value={device} onChange={pickDevice} />
      </div>

      <div className="mt-3 flex items-center justify-between px-1">
        <p className="telemetry" data-testid="recipe-progress">
          {done.filter((id) => steps.some((s) => s.id === id)).length} / {steps.length} steps done
        </p>
        {done.length > 0 && (
          <button
            type="button"
            className="telemetry text-dim active:text-text-2"
            onClick={() => {
              setDone([]);
              writeJson(DONE_KEY, []);
            }}
          >
            Reset
          </button>
        )}
      </div>

      <ol className="mt-2 space-y-2">
        {steps.map((s) => {
          const isDone = done.includes(s.id);
          const isOpen = open === s.id;
          return (
            <li key={s.id} id={`step-${s.id}`} className="scroll-mt-4">
              <div className={`surface transition-colors ${isOpen ? "surface-elevated" : ""}`}>
                <div className="flex items-start gap-3 px-4 py-3.5">
                  <motion.button
                    type="button"
                    onClick={() => toggleDone(s.id)}
                    aria-label={isDone ? `Mark step ${s.n} not done` : `Mark step ${s.n} done`}
                    aria-pressed={isDone}
                    whileTap={{ scale: 0.9 }}
                    transition={spring.press}
                    className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full font-mono text-[11px] font-medium"
                    style={
                      isDone
                        ? { color: "var(--bg)", background: SIGNAL.green, boxShadow: `0 0 14px ${alpha(SIGNAL.green, 45)}` }
                        : { color: "var(--text-2)", background: "rgb(255 255 255 / 0.04)", boxShadow: "inset 0 0 0 1px var(--hairline-strong)" }
                    }
                  >
                    <AnimatePresence mode="popLayout" initial={false}>
                      <motion.span
                        key={isDone ? "done" : "n"}
                        initial={{ scale: 0.5, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.5, opacity: 0 }}
                        transition={spring.bouncy}
                      >
                        {isDone ? <Check /> : s.n}
                      </motion.span>
                    </AnimatePresence>
                  </motion.button>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={`step-body-${s.id}`}
                    onClick={() => setOpen(isOpen ? null : s.id)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <span className="block min-w-0 flex-1 py-0.5">
                      <span className={`block text-[16px] font-semibold leading-tight ${isDone && !isOpen ? "text-text-2" : "text-text"}`}>
                        {s.title}
                      </span>
                      <span className="mt-1 block text-[13px] leading-snug text-muted">{s.summary}</span>
                    </span>
                    <Chevron open={isOpen} />
                  </button>
                </div>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      key="body"
                      id={`step-body-${s.id}`}
                      data-testid={`step-body-${s.id}`}
                      className="border-t border-hairline px-4 pb-4 pt-4"
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, transition: { duration: 0.12 } }}
                      transition={{ duration: 0.28, ease: ease.out }}
                    >
                      {s.body}
                      <Button variant="secondary" size="md" fullWidth className="mt-4" onClick={() => markDone(s.id)}>
                        {isDone ? "Next step" : "Done — next step"}
                      </Button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </li>
          );
        })}
      </ol>
      <p className="telemetry mt-3 px-1 text-center text-[9.5px] text-dim">
        Action names can differ slightly between iOS versions.
      </p>
    </div>
  );
}
