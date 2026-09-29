"use client";

import { motion, useReducedMotion } from "motion/react";
import { ease } from "@/lib/ui/motion";

/**
 * Deviation from a personal baseline: a track centered on the baseline, and a
 * bar that grows from the center toward the side the value is on (right =
 * above baseline), green when that's good for this input and red when it
 * isn't. `z` is in standard deviations, clamped to ±3 (the track's ends).
 */
export function DeviationBar({ z, good, delay = 0 }: { z: number; good: boolean; delay?: number }) {
  const reduced = useReducedMotion();
  const zc = Math.max(-3, Math.min(3, z));
  const width = (Math.abs(zc) / 3) * 50;
  const flat = Math.abs(zc) < 0.15;
  const color = flat ? "var(--muted)" : good ? "var(--recovery-green)" : "var(--recovery-red)";

  return (
    <div aria-hidden className="relative h-[18px]">
      <div className="absolute inset-x-0 top-1/2 h-[6px] -translate-y-1/2 rounded-full bg-white/[0.05]" />
      {/* ±1 and ±2 SD guides */}
      {[1, 2].flatMap((k) => [50 - (k / 3) * 50, 50 + (k / 3) * 50]).map((x) => (
        <span key={x} className="absolute top-1/2 h-[6px] w-px -translate-y-1/2 bg-white/[0.07]" style={{ left: `${x}%` }} />
      ))}
      <motion.div
        className="absolute top-1/2 h-[6px] -translate-y-1/2 rounded-full"
        style={{
          width: `${Math.max(width, flat ? 1.2 : 2)}%`,
          left: zc >= 0 ? "50%" : `${50 - Math.max(width, 2)}%`,
          originX: zc >= 0 ? 0 : 1,
          background: color,
          boxShadow: flat ? undefined : `0 0 10px color-mix(in srgb, ${color} 55%, transparent)`,
        }}
        initial={{ scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={reduced ? { duration: 0 } : { duration: 0.9, delay, ease: ease.outExpo }}
      />
      {/* Baseline marker */}
      <span className="absolute left-1/2 top-0 h-full w-[2px] -translate-x-1/2 rounded-full bg-white/60" />
    </div>
  );
}

/**
 * Thin horizontal meter (0-1), wiping in from the left. Optional `mark` draws
 * a target tick (e.g. 100 % of sleep need).
 */
export function Meter({
  value,
  color,
  height = 6,
  delay = 0,
  mark,
}: {
  value: number;
  color: string;
  height?: number;
  delay?: number;
  mark?: number;
}) {
  const reduced = useReducedMotion();
  const v = Math.max(0, Math.min(1, value));
  return (
    <div aria-hidden className="relative rounded-full bg-white/[0.05]" style={{ height }}>
      <motion.div
        className="absolute inset-y-0 left-0 origin-left rounded-full"
        style={{
          width: `${Math.max(v * 100, v > 0 ? 1.5 : 0)}%`,
          background: `linear-gradient(90deg, color-mix(in srgb, ${color} 55%, transparent), ${color})`,
          boxShadow: `0 0 10px -1px color-mix(in srgb, ${color} 55%, transparent)`,
        }}
        initial={{ scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={reduced ? { duration: 0 } : { duration: 1, delay, ease: ease.outExpo }}
      />
      {typeof mark === "number" && (
        <span
          className="absolute -top-[3px] w-[2px] rounded-full bg-white/70"
          style={{ left: `calc(${Math.max(0, Math.min(1, mark)) * 100}% - 1px)`, height: height + 6 }}
        />
      )}
    </div>
  );
}
