"use client";

import { motion } from "motion/react";
import { useMemo, useState, type ReactNode } from "react";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Sheet } from "@/components/ui/Sheet";
import { TextField } from "@/components/ui/TextField";
import { listTimezones } from "@/lib/admin/timezones";
import {
  ageOn,
  cmToFtIn,
  dobBounds,
  DISPLAY_NAME_MAX,
  estimatedMaxHr,
  ftInToCm,
  kgToLb,
  lbToKg,
  SEX_LABELS,
  SEXES,
  SLEEP_GOAL_MIN,
  STEP_GOAL,
  USERNAME_MAX,
  USERNAME_MIN,
  formatSleepGoal,
  type Sex,
} from "@/lib/profile/schema";
import type { Units } from "@/db/schema";
import { SIGNAL } from "@/lib/ui/colors";
import { spring } from "@/lib/ui/motion";
import type { UsernameStatus } from "./useUsernameStatus";

/*
 * Field building blocks shared by the onboarding steps and the Profile edit
 * sheets, so both validate and look identical. All are controlled and only
 * display the `error` they are given (validation lives in lib/profile/schema).
 */

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export function DisplayNameField({
  value,
  onChange,
  error,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  error?: string | null;
  autoFocus?: boolean;
}) {
  return (
    <TextField
      label="Display name"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      error={error}
      maxLength={DISPLAY_NAME_MAX + 10}
      autoComplete="name"
      autoCapitalize="words"
      autoFocus={autoFocus}
      placeholder="Alex Rivera"
      enterKeyHint="next"
    />
  );
}

function StatusIcon({ status }: { status: UsernameStatus }) {
  if (status.state === "checking") {
    return (
      <span
        aria-hidden
        className="animate-spin-fast block size-4 rounded-full border-2 border-muted border-r-transparent"
      />
    );
  }
  if (status.state === "available") {
    return (
      <motion.svg
        aria-hidden
        width="20"
        height="20"
        viewBox="0 0 20 20"
        fill="none"
        stroke={SIGNAL.green}
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ scale: 0.4, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={spring.bouncy}
      >
        <path d="m4.5 10.5 3.6 3.6 7.4-8" />
      </motion.svg>
    );
  }
  if (status.state === "invalid" || status.state === "taken") {
    return (
      <motion.svg
        aria-hidden
        width="20"
        height="20"
        viewBox="0 0 20 20"
        fill="none"
        stroke={SIGNAL.red}
        strokeWidth="2.2"
        strokeLinecap="round"
        initial={{ scale: 0.4, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={spring.bouncy}
      >
        <path d="m5.5 5.5 9 9M14.5 5.5l-9 9" />
      </motion.svg>
    );
  }
  return null;
}

export function UsernameField({
  value,
  onChange,
  status,
  error,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  status: UsernameStatus;
  /** Extra error (e.g. a server rejection); wins over the live status. */
  error?: string | null;
  autoFocus?: boolean;
}) {
  const statusError = status.state === "invalid" || status.state === "taken" ? status.message : null;
  const shownError = error ?? statusError;
  const hint: ReactNode =
    status.state === "available" ? (
      <span style={{ color: SIGNAL.green }}>@{value} is available</span>
    ) : status.state === "checking" ? (
      "Checking…"
    ) : status.state === "error" ? (
      "Couldn't check right now. We'll verify when you continue."
    ) : (
      `${USERNAME_MIN}-${USERNAME_MAX} characters: lowercase letters, numbers and underscores.`
    );

  return (
    <TextField
      label="Username"
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/^@/, "").toLowerCase())}
      error={shownError}
      hint={hint}
      leading="@"
      trailing={<StatusIcon status={status} />}
      autoComplete="username"
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      autoFocus={autoFocus}
      placeholder="alex_runs"
      enterKeyHint="next"
    />
  );
}

// ---------------------------------------------------------------------------
// Basics
// ---------------------------------------------------------------------------

export function UnitsField({ value, onChange }: { value: Units; onChange: (v: Units) => void }) {
  return (
    <div>
      <p className="label mb-2">Units</p>
      <SegmentedControl<Units>
        ariaLabel="Units"
        value={value}
        onChange={onChange}
        options={[
          { value: "metric", label: "Metric" },
          { value: "imperial", label: "Imperial" },
        ]}
      />
      <p className="mt-2 text-[13px] leading-snug text-muted">
        {value === "metric" ? "Centimetres and kilograms." : "Feet, inches and pounds."}
      </p>
    </div>
  );
}

export function DobField({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  error?: string | null;
}) {
  const bounds = useMemo(() => dobBounds(), []);
  const age = value ? ageOn(value) : NaN;
  return (
    <TextField
      label="Date of birth"
      type="date"
      value={value}
      min={bounds.min}
      max={bounds.max}
      onChange={(e) => onChange(e.target.value)}
      error={error}
      hint={Number.isFinite(age) && age >= 0 ? `Age ${age}. Used for your heart-rate zones.` : "Used for your heart-rate zones."}
      autoComplete="bday"
      className="min-w-0 appearance-none text-left [&::-webkit-date-and-time-value]:text-left"
    />
  );
}

export function SexField({
  value,
  onChange,
  error,
}: {
  value: Sex | null;
  onChange: (v: Sex) => void;
  error?: string | null;
}) {
  return (
    <div>
      <p id="sex-label" className="label mb-2">
        Sex
      </p>
      <div role="radiogroup" aria-labelledby="sex-label" className="grid grid-cols-2 gap-2">
        {SEXES.map((s) => {
          const active = value === s;
          return (
            <motion.button
              key={s}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(s)}
              whileTap={{ scale: 0.97 }}
              transition={spring.press}
              className={`relative h-12 rounded-xl px-3 text-[14px] font-semibold transition-colors duration-200 ${
                active ? "text-bg" : "text-text-2"
              }`}
              style={{
                boxShadow: active ? undefined : "inset 0 0 0 1px var(--hairline-strong)",
                background: active ? "#fff" : "var(--card-sunken)",
              }}
            >
              {SEX_LABELS[s]}
            </motion.button>
          );
        })}
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-[13px] leading-snug text-recovery-red">
          {error}
        </p>
      ) : (
        <p className="mt-2 text-[13px] leading-snug text-muted">Only used in Huddle&rsquo;s formulas.</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Timezone (searchable)
// ---------------------------------------------------------------------------

function offsetLabel(tz: string): string {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" })
      .formatToParts(new Date())
      .find((p) => p.type === "timeZoneName");
    return part?.value ?? "";
  } catch {
    return "";
  }
}

function prettyZone(tz: string): { city: string; region: string } {
  const parts = tz.split("/");
  const city = (parts[parts.length - 1] ?? tz).replace(/_/g, " ");
  return { city, region: parts.length > 1 ? parts.slice(0, -1).join(" / ").replace(/_/g, " ") : "" };
}

const MAX_RESULTS = 60;

function TimezonePicker({
  open,
  onClose,
  value,
  detected,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  value: string;
  detected: string;
  onPick: (tz: string) => void;
}) {
  const [query, setQuery] = useState("");
  const zones = useMemo(() => (open ? listTimezones() : []), [open]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/[\s/]+/g, "_");
    const list = q ? zones.filter((z) => z.toLowerCase().includes(q) || z.toLowerCase().replace(/_/g, "").includes(q)) : zones;
    return list.slice(0, MAX_RESULTS);
  }, [zones, query]);

  return (
    <Sheet open={open} onClose={onClose} title="Timezone">
      <div className="space-y-3 pb-2">
        <TextField
          label="Search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="City or region"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
        />
        <ul role="listbox" aria-label="Timezones" className="-mx-1">
          {results.map((tz) => {
            const selected = tz === value;
            const { city, region } = prettyZone(tz);
            return (
              <li key={tz} role="option" aria-selected={selected}>
                <button
                  type="button"
                  onClick={() => {
                    onPick(tz);
                    setQuery("");
                    onClose();
                  }}
                  className="flex min-h-[52px] w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors active:bg-white/[0.05]"
                >
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-[15px] ${selected ? "font-semibold text-text" : "text-text-2"}`}>
                      {city}
                    </span>
                    <span className="telemetry mt-0.5 block truncate">
                      {region || "Universal"}
                      {tz === detected ? " · Detected" : ""}
                    </span>
                  </span>
                  <span className="telemetry shrink-0">{offsetLabel(tz)}</span>
                  {selected && (
                    <svg
                      aria-hidden
                      width="18"
                      height="18"
                      viewBox="0 0 20 20"
                      fill="none"
                      stroke={SIGNAL.strain}
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="m4.5 10.5 3.6 3.6 7.4-8" />
                    </svg>
                  )}
                </button>
              </li>
            );
          })}
          {results.length === 0 && <li className="px-3 py-6 text-center text-[14px] text-muted">No matching timezone.</li>}
        </ul>
      </div>
    </Sheet>
  );
}

export function TimezoneField({
  value,
  onChange,
  detected,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  /** The browser's timezone, to mark in the list. */
  detected: string;
  error?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const { city, region } = prettyZone(value);
  return (
    <div>
      <p className="label mb-2">Timezone</p>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="flex h-12 w-full items-center gap-3 rounded-xl bg-card-sunken px-4 text-left shadow-[inset_0_1px_2px_rgb(0_0_0/0.5),inset_0_0_0_1px_var(--hairline-strong)]"
      >
        <span className="min-w-0 flex-1 truncate text-[16px] text-text">
          {city}
          {region && <span className="text-muted">{`  ·  ${region}`}</span>}
        </span>
        <span className="telemetry shrink-0">{offsetLabel(value)}</span>
        <svg
          aria-hidden
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0 text-muted"
        >
          <path d="m4 6.5 4 4 4-4" />
        </svg>
      </button>
      {error ? (
        <p role="alert" className="mt-2 text-[13px] leading-snug text-recovery-red">
          {error}
        </p>
      ) : (
        <p className="mt-2 text-[13px] leading-snug text-muted">
          {value === detected ? "Detected from your device." : "Days roll over at midnight in this timezone."}
        </p>
      )}
      <TimezonePicker open={open} onClose={() => setOpen(false)} value={value} detected={detected} onPick={onChange} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Body
// ---------------------------------------------------------------------------

const numOrNull = (text: string): number | null => {
  const t = text.trim();
  if (t === "") return null;
  return Number(t.replace(",", "."));
};

/** Height. Metric: one cm box. Imperial: ft + in boxes. Emits centimetres (or null/NaN while incomplete). Remount (key) when units change. */
export function HeightField({
  units,
  valueCm,
  onChange,
  error,
}: {
  units: Units;
  valueCm: number | null;
  onChange: (cm: number | null) => void;
  error?: string | null;
}) {
  const initial = useMemo(() => {
    if (valueCm == null || !Number.isFinite(valueCm)) return { cm: "", ft: "", inch: "" };
    const f = cmToFtIn(valueCm);
    return { cm: String(Math.round(valueCm)), ft: String(f.ft), inch: String(f.in) };
    // Only the initial value seeds the inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [cm, setCm] = useState(initial.cm);
  const [ft, setFt] = useState(initial.ft);
  const [inch, setInch] = useState(initial.inch);

  const emitImperial = (f: string, i: string) => {
    const feet = numOrNull(f);
    if (feet === null) return onChange(null);
    const inches = numOrNull(i) ?? 0;
    if (Number.isNaN(feet) || Number.isNaN(inches) || inches < 0 || inches >= 12 || feet < 0) return onChange(NaN);
    onChange(ftInToCm(feet, inches));
  };

  if (units === "metric") {
    return (
      <TextField
        label="Height"
        inputMode="decimal"
        value={cm}
        onChange={(e) => {
          setCm(e.target.value);
          onChange(numOrNull(e.target.value));
        }}
        error={error}
        trailing={<span className="telemetry">cm</span>}
        placeholder="178"
        autoComplete="off"
        enterKeyHint="next"
      />
    );
  }
  return (
    <div>
      <div className="grid grid-cols-2 gap-3">
        <TextField
          label="Height"
          inputMode="numeric"
          value={ft}
          onChange={(e) => {
            setFt(e.target.value);
            emitImperial(e.target.value, inch);
          }}
          trailing={<span className="telemetry">ft</span>}
          placeholder="5"
          aria-label="Height, feet"
          aria-invalid={error ? true : undefined}
          autoComplete="off"
          enterKeyHint="next"
        />
        <TextField
          label={" "}
          inputMode="numeric"
          value={inch}
          onChange={(e) => {
            setInch(e.target.value);
            emitImperial(ft, e.target.value);
          }}
          trailing={<span className="telemetry">in</span>}
          placeholder="10"
          aria-label="Height, inches"
          aria-invalid={error ? true : undefined}
          autoComplete="off"
          enterKeyHint="next"
        />
      </div>
      {error && (
        <p role="alert" className="mt-2 text-[13px] leading-snug text-recovery-red">
          {error}
        </p>
      )}
    </div>
  );
}

/** Weight. Emits kilograms (or null/NaN while incomplete). Remount (key) when units change. */
export function WeightField({
  units,
  valueKg,
  onChange,
  error,
}: {
  units: Units;
  valueKg: number | null;
  onChange: (kg: number | null) => void;
  error?: string | null;
}) {
  const [text, setText] = useState(() => {
    if (valueKg == null || !Number.isFinite(valueKg)) return "";
    return units === "imperial" ? String(Math.round(kgToLb(valueKg))) : String(Math.round(valueKg * 10) / 10);
  });
  return (
    <TextField
      label="Weight"
      inputMode="decimal"
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const n = numOrNull(e.target.value);
        onChange(n === null || Number.isNaN(n) ? n : units === "imperial" ? lbToKg(n) : Math.round(n * 100) / 100);
      }}
      error={error}
      trailing={<span className="telemetry">{units === "imperial" ? "lb" : "kg"}</span>}
      placeholder={units === "imperial" ? "165" : "75"}
      autoComplete="off"
      enterKeyHint="done"
    />
  );
}

/** Optional max heart rate; placeholder shows the age-based estimate. */
export function MaxHrField({
  value,
  onChange,
  dob,
  error,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  dob: string | null;
  error?: string | null;
}) {
  const [text, setText] = useState(value == null ? "" : String(value));
  const age = dob ? ageOn(dob) : NaN;
  const estimate = Number.isFinite(age) ? estimatedMaxHr(age) : 187;
  return (
    <TextField
      label="Max heart rate (optional)"
      inputMode="numeric"
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(numOrNull(e.target.value));
      }}
      error={error}
      trailing={<span className="telemetry">bpm</span>}
      placeholder={`Estimated ${estimate}`}
      hint="Leave blank and Huddle uses 208 − 0.7 × your age."
      autoComplete="off"
      enterKeyHint="done"
    />
  );
}

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

function StepperButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <motion.button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      whileTap={disabled ? undefined : { scale: 0.9 }}
      transition={spring.press}
      className="grid size-12 shrink-0 place-items-center rounded-full bg-white/[0.03] text-text shadow-[inset_0_0_0_1px_var(--hairline-strong),inset_0_1px_0_rgb(255_255_255/0.06)] disabled:opacity-30"
    >
      {children}
    </motion.button>
  );
}

function Slider({
  value,
  min,
  max,
  step,
  onChange,
  label,
  color,
  format,
  showEnds,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  label: string;
  color: string;
  format: (v: number) => string;
  showEnds?: [string, string];
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="flex-1">
      <input
        type="range"
        className="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        aria-valuetext={format(value)}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ "--pct": `${pct}%`, "--range-color": color } as React.CSSProperties}
      />
      {showEnds && (
        <div className="telemetry mt-0.5 flex justify-between px-0.5">
          <span>{showEnds[0]}</span>
          <span>{showEnds[1]}</span>
        </div>
      )}
    </div>
  );
}

const MinusIcon = () => (
  <svg aria-hidden width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M4 9h10" />
  </svg>
);
const PlusIcon = () => (
  <svg aria-hidden width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M4 9h10M9 4v10" />
  </svg>
);

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export function StepGoalField({ value, onChange, error, compact }: { value: number; onChange: (v: number) => void; error?: string | null; compact?: boolean }) {
  const set = (v: number) => onChange(clamp(v, STEP_GOAL.min, STEP_GOAL.max));
  return (
    <div className="text-center">
      <p className="label">Daily steps</p>
      <p className={`num mt-3 font-display font-bold leading-[0.9] tracking-[0.01em] ${compact ? "text-[68px]" : "text-[88px]"}`} aria-live="polite">
        {value.toLocaleString("en-US")}
      </p>
      <p className="telemetry mt-2">Steps / day</p>
      <div className="mt-5 flex items-center gap-3">
        <StepperButton label="Decrease step goal" onClick={() => set(value - 1000)} disabled={value <= STEP_GOAL.min}>
          <MinusIcon />
        </StepperButton>
        <Slider
          value={value}
          min={STEP_GOAL.min}
          max={STEP_GOAL.max}
          step={STEP_GOAL.step}
          onChange={set}
          label="Daily step goal"
          color={SIGNAL.strain}
          format={(v) => `${v.toLocaleString("en-US")} steps`}
          showEnds={["1,000", "50,000"]}
        />
        <StepperButton label="Increase step goal" onClick={() => set(value + 1000)} disabled={value >= STEP_GOAL.max}>
          <PlusIcon />
        </StepperButton>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-[13px] text-recovery-red">
          {error}
        </p>
      )}
    </div>
  );
}

export function SleepGoalField({ value, onChange, error, compact }: { value: number; onChange: (v: number) => void; error?: string | null; compact?: boolean }) {
  const set = (v: number) => onChange(clamp(v, SLEEP_GOAL_MIN.min, SLEEP_GOAL_MIN.max));
  const h = Math.floor(value / 60);
  const m = value % 60;
  return (
    <div className="text-center">
      <p className="label">Nightly sleep</p>
      <p
        className={`num mt-3 font-display font-bold leading-[0.9] tracking-[0.01em] ${compact ? "text-[68px]" : "text-[88px]"}`}
        aria-label={formatSleepGoal(value)}
        aria-live="polite"
      >
        <span aria-hidden>
          {h}
          <span className={`ml-0.5 mr-2 text-muted ${compact ? "text-[30px]" : "text-[40px]"}`}>h</span>
          {String(m).padStart(2, "0")}
          <span className={`ml-0.5 text-muted ${compact ? "text-[30px]" : "text-[40px]"}`}>m</span>
        </span>
      </p>
      <p className="telemetry mt-2">Sleep need / night</p>
      <div className="mt-5 flex items-center gap-3">
        <StepperButton label="Decrease sleep goal" onClick={() => set(value - 15)} disabled={value <= SLEEP_GOAL_MIN.min}>
          <MinusIcon />
        </StepperButton>
        <Slider
          value={value}
          min={SLEEP_GOAL_MIN.min}
          max={SLEEP_GOAL_MIN.max}
          step={SLEEP_GOAL_MIN.step}
          onChange={set}
          label="Nightly sleep goal"
          color={SIGNAL.sleep}
          format={formatSleepGoal}
          showEnds={["5h", "12h"]}
        />
        <StepperButton label="Increase sleep goal" onClick={() => set(value + 15)} disabled={value >= SLEEP_GOAL_MIN.max}>
          <PlusIcon />
        </StepperButton>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-[13px] text-recovery-red">
          {error}
        </p>
      )}
    </div>
  );
}
