"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { alpha, SIGNAL } from "@/lib/ui/colors";

/**
 * Small looping illustrations for the install guide. Drawn from scratch (no
 * Apple assets): a Safari toolbar, a share sheet and a Home Screen. Every loop
 * is one shared timeline (CYCLE seconds) built from transform/opacity only, and
 * they freeze on a readable frame when the user prefers reduced motion.
 */

const CYCLE = 4.2;
const loop = { duration: CYCLE, repeat: Infinity, ease: "easeInOut" as const };

export function ShareGlyph({ size = 22, className = "" }: { size?: number; className?: string }) {
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 3.5v11M8.4 7 12 3.4 15.6 7M8 10.5H7a2 2 0 0 0-2 2v6.3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6.3a2 2 0 0 0-2-2h-1" />
    </svg>
  );
}

function PlusSquareGlyph({ size = 20 }: { size?: number }) {
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
      <path d="M12 8.2v7.6M8.2 12h7.6" />
    </svg>
  );
}

/** Expanding tap ring. `at` is the fraction of the cycle where the tap lands. */
function Tap({ at, color = "#fff", size = 44 }: { at: number; color?: string; size?: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.span
      aria-hidden
      className="pointer-events-none absolute rounded-full"
      style={{ width: size, height: size, left: "50%", top: "50%", marginLeft: -size / 2, marginTop: -size / 2, border: `2px solid ${color}` }}
      initial={false}
      animate={reduce ? { opacity: 0.5, scale: 1 } : { opacity: [0, 0, 0.7, 0], scale: [0.5, 0.5, 1.5, 1.7] }}
      transition={{ ...loop, times: [0, at, at + 0.06, Math.min(at + 0.22, 1)] }}
    />
  );
}

function Stage({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div
      role="img"
      aria-label={label}
      className="relative mb-4 h-[168px] overflow-hidden rounded-xl bg-card-sunken shadow-[inset_0_0_0_1px_var(--hairline)]"
    >
      {children}
    </div>
  );
}

/** Step 1: Safari's bottom toolbar with the Share button pulsing. */
export function ShareButtonMock() {
  const reduce = useReducedMotion();
  return (
    <Stage label="Safari's toolbar with the Share button highlighted">
      {/* faux page */}
      <div className="absolute inset-x-5 top-4 space-y-2 opacity-60">
        <div className="h-3 w-24 rounded-full bg-white/10" />
        <div className="h-2 w-full rounded-full bg-white/[0.06]" />
        <div className="h-2 w-4/5 rounded-full bg-white/[0.06]" />
      </div>
      {/* toolbar */}
      <div className="absolute inset-x-3 bottom-3 rounded-2xl bg-white/[0.07] px-3 pb-2.5 pt-2 shadow-[inset_0_0_0_1px_var(--hairline-strong)]">
        <div className="mx-auto mb-2 flex h-7 max-w-[210px] items-center justify-center gap-1.5 rounded-lg bg-white/[0.07] text-[10px] text-text-2">
          <svg aria-hidden width="9" height="9" viewBox="0 0 24 24" fill="currentColor">
            <path d="M7 10V8a5 5 0 0 1 10 0v2h1.5A1.5 1.5 0 0 1 20 11.5v8a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19.5v-8A1.5 1.5 0 0 1 5.5 10H7Zm2 0h6V8a3 3 0 0 0-6 0v2Z" />
          </svg>
          huddle
        </div>
        <div className="flex items-center justify-around text-text-2">
          <svg aria-hidden width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className="opacity-60">
            <path d="m14.5 5.5-6.5 6.5 6.5 6.5" />
          </svg>
          <svg aria-hidden width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className="opacity-30">
            <path d="m9.5 5.5 6.5 6.5-6.5 6.5" />
          </svg>
          <span className="relative grid size-9 place-items-center rounded-full" style={{ color: SIGNAL.strain }}>
            <motion.span
              aria-hidden
              className="absolute inset-0 rounded-full"
              style={{ background: alpha(SIGNAL.strain, 16), boxShadow: `inset 0 0 0 1px ${alpha(SIGNAL.strain, 45)}` }}
              initial={false}
              animate={reduce ? { opacity: 1 } : { opacity: [0.35, 0.35, 1, 1, 0.35] }}
              transition={{ ...loop, times: [0, 0.25, 0.4, 0.8, 1] }}
            />
            <motion.span
              className="relative"
              initial={false}
              animate={reduce ? { scale: 1 } : { scale: [1, 1, 0.86, 1, 1] }}
              transition={{ ...loop, times: [0, 0.3, 0.36, 0.46, 1] }}
            >
              <ShareGlyph size={21} />
            </motion.span>
            <Tap at={0.3} color={SIGNAL.strain} />
          </span>
          <svg aria-hidden width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="opacity-60">
            <path d="M5 4.5h8.5a3 3 0 0 1 3 3V20L12 17l-4.5 3V7.5a3 3 0 0 1-2.5-3Z" transform="translate(1 0)" />
          </svg>
          <svg aria-hidden width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="opacity-60">
            <rect x="4" y="7" width="12" height="12" rx="2.5" />
            <path d="M8 7V6a2.5 2.5 0 0 1 2.5-2.5H17A2.5 2.5 0 0 1 19.5 6v6.5A2.5 2.5 0 0 1 17 15h-1" />
          </svg>
        </div>
      </div>
    </Stage>
  );
}

const SHEET_ROWS = [
  { label: "Copy", widths: "w-10" },
  { label: "Add to Bookmarks", widths: "w-28" },
  { label: "Add to Home Screen", widths: "", active: true },
  { label: "Find on Page", widths: "w-20" },
];

/** Step 2: a share sheet with "Add to Home Screen" lighting up. */
export function ShareSheetMock() {
  const reduce = useReducedMotion();
  return (
    <Stage label="The share sheet with Add to Home Screen highlighted">
      <motion.div
        className="absolute inset-x-4 bottom-0 top-4 rounded-t-2xl bg-card-elevated px-3 pt-2.5 shadow-[inset_0_1px_0_rgb(255_255_255/0.12),0_-10px_30px_rgb(0_0_0/0.4)]"
        initial={false}
        animate={reduce ? { y: 0 } : { y: [46, 0, 0, 0, 46] }}
        transition={{ ...loop, times: [0, 0.14, 0.5, 0.86, 1] }}
      >
        <div className="mx-auto mb-2.5 h-1 w-9 rounded-full bg-white/20" />
        <ul className="space-y-1.5">
          {SHEET_ROWS.map((r) => (
            <li key={r.label} className="relative flex h-[30px] items-center justify-between rounded-lg bg-white/[0.045] px-3 text-[12px] text-text-2">
              {r.active && (
                <motion.span
                  aria-hidden
                  className="absolute inset-0 rounded-lg"
                  style={{ background: alpha(SIGNAL.green, 16), boxShadow: `inset 0 0 0 1px ${alpha(SIGNAL.green, 55)}` }}
                  initial={false}
                  animate={reduce ? { opacity: 1 } : { opacity: [0, 0, 1, 1, 0] }}
                  transition={{ ...loop, times: [0, 0.3, 0.42, 0.84, 1] }}
                />
              )}
              <span className={`relative ${r.active ? "font-semibold text-text" : ""}`}>{r.label}</span>
              <span className="relative" style={r.active ? { color: SIGNAL.green } : { opacity: 0.55 }}>
                {r.active ? <PlusSquareGlyph size={17} /> : <span className={`block h-2 rounded-full bg-white/25 ${r.widths}`} />}
              </span>
              {r.active && (
                <span className="absolute right-6 top-1/2">
                  <Tap at={0.42} color={SIGNAL.green} size={38} />
                </span>
              )}
            </li>
          ))}
        </ul>
      </motion.div>
    </Stage>
  );
}

/** Step 3: the Huddle icon landing on a Home Screen. */
export function HomeScreenMock() {
  const reduce = useReducedMotion();
  const slots = Array.from({ length: 7 });
  return (
    <Stage label="A Home Screen with the Huddle icon added">
      <div className="absolute inset-x-10 top-4 grid grid-cols-4 gap-x-4 gap-y-3">
        {slots.map((_, i) => (
          <div key={i} className="flex flex-col items-center gap-1.5">
            <div className="aspect-square w-full rounded-[13px] bg-white/[0.06]" />
            <div className="h-1.5 w-7 rounded-full bg-white/[0.06]" />
          </div>
        ))}
        <div className="relative flex flex-col items-center gap-1.5">
          <motion.div
            className="relative aspect-square w-full overflow-hidden rounded-[13px] bg-bg shadow-[0_0_0_1px_var(--hairline-strong),0_6px_18px_-4px_rgb(61_155_255/0.5)]"
            initial={false}
            animate={reduce ? { scale: 1, opacity: 1 } : { scale: [0.2, 0.2, 1.14, 1, 1, 0.2], opacity: [0, 0, 1, 1, 1, 0] }}
            transition={{ ...loop, times: [0, 0.22, 0.34, 0.4, 0.88, 1] }}
          >
            <svg aria-hidden viewBox="60 60 392 392" className="absolute inset-0 size-full p-[3px]">
              <g fill="none" strokeWidth="38" strokeLinecap="round">
                <circle cx="256" cy="196" r="92" stroke="#2BD67B" />
                <circle cx="196" cy="300" r="92" stroke="#3D9BFF" />
                <circle cx="316" cy="300" r="92" stroke="#8C9BFF" />
              </g>
            </svg>
          </motion.div>
          <motion.span
            className="text-[9px] font-medium leading-none text-text-2"
            initial={false}
            animate={reduce ? { opacity: 1 } : { opacity: [0, 0, 1, 1, 0] }}
            transition={{ ...loop, times: [0, 0.3, 0.4, 0.88, 1] }}
          >
            Huddle
          </motion.span>
          <Tap at={0.62} color={SIGNAL.green} size={44} />
        </div>
      </div>
    </Stage>
  );
}
