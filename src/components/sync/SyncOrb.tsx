"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { alpha } from "@/lib/ui/colors";
import { ease } from "@/lib/ui/motion";

/** calm = idle; dormant = nothing to sync yet; busy = rings spinning; burst = success; alert = error. */
export type OrbMode = "calm" | "dormant" | "busy" | "burst" | "alert";

const SIZE = 264;
const C = SIZE / 2;
const TICKS = 72;
const CORE_R = 80;

/** Rounded so server and client render identical attributes (no hydration mismatch). */
const round = (n: number) => Math.round(n * 100) / 100;

function polar(r: number, deg: number): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180;
  return [round(C + r * Math.cos(a)), round(C + r * Math.sin(a))];
}

/** Arc path from `a0` to `a1` degrees (clockwise, 0 = top). */
function arc(r: number, a0: number, a1: number): string {
  const [x0, y0] = polar(r, a0);
  const [x1, y1] = polar(r, a1);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
}

/** Instrument bezel: 72 ticks, every 6th long. Static. */
function Bezel({ color, lit }: { color: string; lit: boolean }) {
  return (
    <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="absolute inset-0" aria-hidden>
      {Array.from({ length: TICKS }, (_, i) => {
        const deg = (360 / TICKS) * i;
        const long = i % 6 === 0;
        const [x0, y0] = polar(long ? 118 : 121, deg);
        const [x1, y1] = polar(126, deg);
        return (
          <line
            key={i}
            x1={x0}
            y1={y0}
            x2={x1}
            y2={y1}
            strokeWidth={long ? 1.6 : 1}
            strokeLinecap="round"
            style={{ stroke: long && lit ? alpha(color, 70) : "var(--hairline-strong)" }}
          />
        );
      })}
    </svg>
  );
}

/** Comet sweeping the bezel while busy: a head plus a fading tail of short arcs. */
function Comet({ color }: { color: string }) {
  const segments = 14;
  return (
    <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="absolute inset-0 overflow-visible" aria-hidden>
      <defs>
        <filter id="orb-comet-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
      </defs>
      <g filter="url(#orb-comet-glow)" opacity={0.9}>
        <path d={arc(122, 344, 360)} strokeWidth={6} strokeLinecap="round" fill="none" style={{ stroke: color }} />
      </g>
      {Array.from({ length: segments }, (_, i) => {
        const a1 = 360 - i * 7;
        return (
          <path
            key={i}
            d={arc(122, a1 - 7.5, a1)}
            fill="none"
            strokeWidth={i === 0 ? 3 : 2.4}
            strokeLinecap="round"
            style={{ stroke: color, opacity: Math.max(0, 1 - i / segments) ** 1.6 }}
          />
        );
      })}
      <circle cx={polar(122, 0)[0]} cy={polar(122, 0)[1]} r={3.2} style={{ fill: "white" }} />
    </svg>
  );
}

/** Dashed data ring (segments of varying length, like a telemetry ring). */
function DataRing({ r, color, width, pattern, opacity }: { r: number; color: string; width: number; pattern: number[]; opacity: number }) {
  const gap = 6;
  const arcs: [number, number][] = [];
  for (let a = 0, i = 0; a < 360 - gap; i++) {
    const end = Math.min(360 - gap, a + pattern[i % pattern.length]);
    arcs.push([a, end]);
    a = end + gap;
  }
  return (
    <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="absolute inset-0" aria-hidden>
      {arcs.map(([a0, a1], k) => (
        <path key={k} d={arc(r, a0, a1)} fill="none" strokeWidth={width} strokeLinecap="round" style={{ stroke: color, opacity }} />
      ))}
    </svg>
  );
}

type SyncOrbProps = {
  mode: OrbMode;
  /** Signal color of the current state. */
  color: string;
  /** Changes on each success, replaying the burst. */
  burstKey?: string | number;
  /** Centre readout. */
  children: ReactNode;
};

/**
 * The Sync screen's centrepiece: a telemetry bezel around a glowing core.
 * Calm: the rings drift. Busy: they spin in opposite directions and a comet
 * sweeps the bezel. Burst: shockwave rings and a core "thump" (a visual
 * haptic). Only transform/opacity animate.
 */
export function SyncOrb({ mode, color, burstKey, children }: SyncOrbProps) {
  const reduced = useReducedMotion();
  const busy = mode === "busy";
  const dormant = mode === "dormant";
  const spin = (seconds: number, dir: 1 | -1 = 1) =>
    reduced ? {} : { animate: { rotate: dir * 360 }, transition: { duration: seconds, repeat: Infinity, ease: "linear" as const } };

  return (
    <div className="relative mx-auto" style={{ width: SIZE, height: SIZE }} data-orb-mode={mode}>
      {/* Glow */}
      <motion.div
        aria-hidden
        className="absolute -inset-12 rounded-full"
        animate={{ opacity: dormant ? 0.35 : busy ? 1 : 0.8, scale: busy ? 1.04 : 1 }}
        transition={{ duration: 0.8, ease: ease.out }}
        style={{ background: `radial-gradient(circle, ${alpha(color, 22)} 0%, ${alpha(color, 8)} 38%, transparent 66%)` }}
      />

      <Bezel color={color} lit={!dormant} />

      <AnimatePresence>
        {busy && (
          <motion.div
            key="comet"
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
          >
            <motion.div className="absolute inset-0" {...spin(1.6)}>
              <Comet color={color} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Track + two counter-rotating data rings */}
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="absolute inset-0" aria-hidden>
        <circle cx={C} cy={C} r={108} fill="none" strokeWidth={1} style={{ stroke: "var(--hairline)" }} />
      </svg>
      <motion.div key={`r1-${busy}`} className="absolute inset-0" {...spin(busy ? 5 : 90)}>
        <DataRing r={100} color={color} width={3} pattern={[46, 18, 64, 9, 30, 12]} opacity={dormant ? 0.18 : busy ? 0.95 : 0.55} />
      </motion.div>
      <motion.div key={`r2-${busy}`} className="absolute inset-0" {...spin(busy ? 8 : 140, -1)}>
        <DataRing r={91} color={color} width={1.4} pattern={[0.5]} opacity={dormant ? 0.12 : busy ? 0.6 : 0.3} />
      </motion.div>

      {/* Success shockwaves */}
      <AnimatePresence>
        {mode === "burst" && !reduced && (
          <motion.div key={`burst-${burstKey}`} className="pointer-events-none absolute inset-0" exit={{ opacity: 0 }}>
            {[0, 0.14, 0.28].map((delay) => (
              <motion.span
                key={delay}
                aria-hidden
                className="absolute rounded-full"
                style={{
                  left: C - CORE_R,
                  top: C - CORE_R,
                  width: CORE_R * 2,
                  height: CORE_R * 2,
                  boxShadow: `0 0 0 2px ${color}, 0 0 24px ${alpha(color, 60)}`,
                }}
                initial={{ scale: 1, opacity: 0.9 }}
                animate={{ scale: 1.75, opacity: 0 }}
                transition={{ duration: 1.1, delay, ease: ease.outExpo }}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Core */}
      <motion.div
        key={mode === "burst" ? `core-${burstKey}` : "core"}
        className="absolute grid place-items-center rounded-full text-center"
        style={{
          left: C - CORE_R,
          top: C - CORE_R,
          width: CORE_R * 2,
          height: CORE_R * 2,
          background: `radial-gradient(circle at 50% 30%, ${alpha(color, dormant ? 6 : 16)} 0%, transparent 70%), linear-gradient(180deg, var(--card-elevated), var(--card-sunken))`,
          boxShadow: `inset 0 1px 0 rgb(255 255 255 / 0.08), inset 0 0 0 1px ${alpha(color, dormant ? 14 : 34)}, 0 18px 40px -18px rgb(0 0 0 / 0.9), 0 0 36px -8px ${alpha(color, dormant ? 0 : 45)}`,
        }}
        initial={mode === "burst" && !reduced ? { scale: 0.9 } : false}
        animate={
          mode === "alert" && !reduced
            ? { x: [0, -6, 6, -4, 4, 0], scale: 1 }
            : { scale: 1, x: 0 }
        }
        transition={mode === "burst" ? { type: "spring", stiffness: 520, damping: 12 } : { duration: 0.45, ease: ease.out }}
      >
        <div className="px-4">{children}</div>
      </motion.div>
    </div>
  );
}
