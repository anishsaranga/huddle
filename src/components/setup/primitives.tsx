"use client";

import { AnimatePresence, motion } from "motion/react";
import { useId, useState, type ReactNode } from "react";
import { CopyGlyph, useCopy } from "@/components/apikey/KeyReveal";
import { alpha, SIGNAL } from "@/lib/ui/colors";
import { ease, PRESS_SCALE, spring } from "@/lib/ui/motion";

/** A Shortcuts action name, as a mono "chip". */
export function ActionChip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-white/[0.06] px-2 py-[3px] font-mono text-[12.5px] font-medium leading-tight text-text shadow-[inset_0_0_0_1px_var(--hairline-strong)]">
      <span aria-hidden className="size-1.5 rounded-[2px]" style={{ background: SIGNAL.strain }} />
      {children}
    </span>
  );
}

/** A Shortcut variable (tinted, like the blue tokens in the Shortcuts editor). */
export function V({ children }: { children: ReactNode }) {
  return (
    <span
      className="inline-flex items-center rounded-[5px] px-1.5 py-px font-mono text-[12px] leading-tight [overflow-wrap:anywhere]"
      style={{ color: SIGNAL.strain, background: alpha(SIGNAL.strain, 12), boxShadow: `inset 0 0 0 1px ${alpha(SIGNAL.strain, 26)}` }}
    >
      {children}
    </span>
  );
}

/** A literal value to type in. */
export function L({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-[5px] bg-card-sunken px-1.5 py-px font-mono text-[12px] leading-tight text-text shadow-[inset_0_0_0_1px_var(--hairline)] [overflow-wrap:anywhere]">
      {children}
    </span>
  );
}

/** An on/off switch value. */
export function Toggle({ on }: { on: boolean }) {
  const color = on ? SIGNAL.green : "var(--muted)";
  return (
    <span
      className="telemetry inline-flex items-center gap-1 rounded-full px-1.5 py-[2px] text-[9.5px] leading-none"
      style={{ color, background: alpha(color, 10), boxShadow: `inset 0 0 0 1px ${alpha(color, 28)}` }}
    >
      <span aria-hidden className="size-1 rounded-full" style={{ background: color }} />
      {on ? "On" : "Off"}
    </span>
  );
}

/** A field of an action: "Label  value". */
export function F({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 py-[3px]">
      {k && <span className="text-[12.5px] text-muted">{k}</span>}
      <span className="flex min-w-0 flex-wrap items-center gap-1 text-[13px] text-text-2">{children}</span>
    </div>
  );
}

/**
 * One action on the step's rail. `depth` indents it (inside If / Repeat);
 * `end` is a closing marker (End If / Otherwise).
 */
export function Act({ name, depth = 0, children, end }: { name: string; depth?: number; children?: ReactNode; end?: boolean }) {
  return (
    <li className="relative py-1.5" style={{ paddingLeft: 22 + depth * 16 }}>
      <span
        aria-hidden
        className="absolute top-[13px] size-[7px] rounded-full"
        style={{
          left: 4 + depth * 16,
          background: end ? "var(--card)" : "var(--text-2)",
          boxShadow: end ? "inset 0 0 0 1.5px var(--dim)" : `0 0 0 3px var(--card)`,
        }}
      />
      {depth > 0 && (
        <span aria-hidden className="absolute top-[16px] h-px bg-hairline-strong" style={{ left: 8, width: depth * 16 - 2 }} />
      )}
      {end ? <span className="font-mono text-[12px] text-muted">{name}</span> : <ActionChip>{name}</ActionChip>}
      {children && <div className="mt-1">{children}</div>}
    </li>
  );
}

/** The rail the actions of a step hang on. */
export function Rail({ children }: { children: ReactNode }) {
  return (
    <ol className="relative">
      <span aria-hidden className="absolute bottom-3 left-[7px] top-3 w-px bg-hairline-strong" />
      {children}
    </ol>
  );
}

/** A quiet tip under a step. */
export function Tip({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "warning" }) {
  const color = tone === "warning" ? SIGNAL.yellow : "var(--text-2)";
  return (
    <p
      className="mt-3 flex items-start gap-2 rounded-xl px-3 py-2.5 text-[13px] leading-snug"
      style={{
        color: tone === "warning" ? color : "var(--muted)",
        background: tone === "warning" ? alpha(color, 7) : "rgb(255 255 255 / 0.025)",
        boxShadow: `inset 0 0 0 1px ${tone === "warning" ? alpha(color, 20) : "var(--hairline)"}`,
      }}
    >
      <span aria-hidden className="telemetry mt-[2px] shrink-0" style={{ color }}>
        {tone === "warning" ? "!" : "Tip"}
      </span>
      <span>{children}</span>
    </p>
  );
}

/** A value with a small copy button (inline, wraps). */
export function CopyChip({ value, label, display, testId }: { value: string; label: string; display?: ReactNode; testId?: string }) {
  const { copied, copy } = useCopy(label);
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-lg bg-card-sunken py-0.5 pl-2 pr-0.5 shadow-[inset_0_0_0_1px_var(--hairline-strong)]">
      <span data-testid={testId} className="min-w-0 font-mono text-[12px] leading-snug text-text [overflow-wrap:anywhere]">
        {display ?? value}
      </span>
      <motion.button
        type="button"
        onClick={() => copy(value)}
        aria-label={`Copy ${label.toLowerCase()}`}
        whileTap={{ scale: PRESS_SCALE }}
        transition={spring.press}
        className="grid size-7 shrink-0 place-items-center rounded-md text-text-2 active:bg-white/[0.06]"
        style={copied ? { color: SIGNAL.green } : undefined}
      >
        <CopyGlyph copied={copied} size={14} />
      </motion.button>
    </span>
  );
}

export const Chevron = ({ open }: { open: boolean }) => (
  <motion.svg
    aria-hidden
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="shrink-0 text-dim"
    animate={{ rotate: open ? 180 : 0 }}
    transition={spring.snappy}
  >
    <path d="m4 6 4 4 4-4" />
  </motion.svg>
);

/** Collapsible row: header button + revealed body (fade/rise only, no height animation). */
export function Disclosure({
  header,
  children,
  open,
  onToggle,
  className = "",
  id,
}: {
  header: ReactNode;
  children: ReactNode;
  open: boolean;
  onToggle: () => void;
  className?: string;
  id?: string;
}) {
  const bodyId = useId();
  return (
    <div id={id} className={className}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={onToggle}
        className="flex w-full items-center gap-3 text-left"
      >
        <span className="min-w-0 flex-1">{header}</span>
        <Chevron open={open} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={bodyId}
            key="body"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.12 } }}
            transition={{ duration: 0.28, ease: ease.out }}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Uncontrolled Disclosure. */
export function Collapsible(props: { header: ReactNode; children: ReactNode; defaultOpen?: boolean; className?: string; id?: string }) {
  const [open, setOpen] = useState(props.defaultOpen ?? false);
  return (
    <Disclosure header={props.header} open={open} onToggle={() => setOpen((o) => !o)} className={props.className} id={props.id}>
      {props.children}
    </Disclosure>
  );
}

/** Section heading: mono kicker + condensed title. */
export function SectionTitle({ kicker, title, children, color }: { kicker: string; title: string; children?: ReactNode; color?: string }) {
  return (
    <div className="px-1 pb-3 pt-8">
      <p className="telemetry" style={color ? { color } : undefined}>
        {kicker}
      </p>
      <h2 className="mt-1.5 font-display text-[30px] font-bold uppercase leading-[0.92] tracking-[0.02em]">{title}</h2>
      {children && <div className="mt-2 text-[15px] leading-relaxed text-muted">{children}</div>}
    </div>
  );
}
