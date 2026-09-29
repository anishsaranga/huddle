"use client";

import { motion, useReducedMotion } from "motion/react";
import { ease } from "@/lib/ui/motion";

export type TimelineBlock = { asleep: boolean; start: number; end: number };

type SleepTimelineProps = {
  blocks: TimelineBlock[];
  startLabel?: string;
  endLabel?: string;
  ariaLabel: string;
  delay?: number;
  className?: string;
};

/**
 * Asleep / awake timeline for trackers that don't report stages (e.g. Zepp):
 * one track, asleep blocks in sleep periwinkle, awake gaps as bright ticks
 * above it. Revealed left→right by a clip wipe (transform only).
 */
export function SleepTimeline({
  blocks,
  startLabel,
  endLabel,
  ariaLabel,
  delay = 0,
  className = "",
}: SleepTimelineProps) {
  const reduced = useReducedMotion();
  if (blocks.length === 0) return null;
  const t0 = Math.min(...blocks.map((b) => b.start));
  const t1 = Math.max(...blocks.map((b) => b.end));
  const pos = (t: number) => ((t - t0) / (t1 - t0 || 1)) * 100;

  return (
    <figure className={className} role="img" aria-label={ariaLabel}>
      <div className="relative h-[34px]">
        <div aria-hidden className="absolute inset-x-0 top-[14px] h-[14px] rounded-full bg-white/[0.04]" />
        {/* Wipe reveal with transforms only: the window slides right while its content counter-slides. */}
        <motion.div
          aria-hidden
          className="absolute inset-0 overflow-hidden"
          initial={{ x: "-100%" }}
          animate={{ x: "0%" }}
          transition={reduced ? { duration: 0 } : { duration: 1.3, delay, ease: ease.out }}
        >
          <motion.div
            className="absolute inset-0"
            initial={{ x: "100%" }}
            animate={{ x: "0%" }}
            transition={reduced ? { duration: 0 } : { duration: 1.3, delay, ease: ease.out }}
          >
            {blocks.map((b, i) =>
              b.asleep ? (
                <span
                  key={i}
                  className="absolute top-[14px] h-[14px] rounded-[4px]"
                  style={{
                    left: `${pos(b.start)}%`,
                    width: `${Math.max(pos(b.end) - pos(b.start), 0.6)}%`,
                    background: "linear-gradient(180deg, var(--stage-core), var(--stage-deep))",
                    boxShadow: "0 0 10px -2px color-mix(in srgb, var(--sleep) 60%, transparent)",
                  }}
                />
              ) : (
                <span
                  key={i}
                  className="absolute top-[2px] h-[26px] rounded-full"
                  style={{
                    left: `${pos(b.start)}%`,
                    width: `max(3px, ${pos(b.end) - pos(b.start)}%)`,
                    background: "var(--stage-awake)",
                    opacity: 0.85,
                  }}
                />
              ),
            )}
          </motion.div>
        </motion.div>
      </div>
      <figcaption aria-hidden className="mt-2 flex items-center justify-between">
        <span className="telemetry text-[9.5px]">{startLabel}</span>
        <span className="telemetry flex items-center gap-3 text-[9.5px]">
          <span className="flex items-center gap-1">
            <span className="size-[6px] rounded-[2px]" style={{ background: "var(--stage-core)" }} />
            Asleep
          </span>
          <span className="flex items-center gap-1">
            <span className="size-[6px] rounded-[2px]" style={{ background: "var(--stage-awake)" }} />
            Awake
          </span>
        </span>
        <span className="telemetry text-[9.5px]">{endLabel}</span>
      </figcaption>
    </figure>
  );
}
