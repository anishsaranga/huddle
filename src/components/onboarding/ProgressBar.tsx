"use client";

import { motion } from "motion/react";
import { ease } from "@/lib/ui/motion";

type ProgressBarProps = {
  /** Zero-based current step. */
  current: number;
  total: number;
  /** Accessible step label, e.g. "Identity". */
  label: string;
};

/** Segmented progress: finished segments dim-white, the current one bright, the rest empty. Fills animate. */
export function ProgressBar({ current, total, label }: ProgressBarProps) {
  return (
    <div
      role="progressbar"
      aria-label="Setup progress"
      aria-valuemin={1}
      aria-valuemax={total}
      aria-valuenow={current + 1}
      aria-valuetext={`Step ${current + 1} of ${total}: ${label}`}
      className="flex flex-1 items-center gap-1.5"
    >
      {Array.from({ length: total }, (_, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <span key={i} className="relative h-[3px] flex-1 rounded-full bg-white/[0.09]">
            <motion.span
              className="absolute inset-0 origin-left rounded-full"
              initial={false}
              animate={{ scaleX: done || active ? 1 : 0, opacity: active ? 1 : done ? 0.42 : 0 }}
              transition={{ duration: 0.5, ease: ease.outExpo }}
              style={{
                background: "#fff",
                boxShadow: active ? "0 0 10px rgb(255 255 255 / 0.55)" : undefined,
              }}
            />
          </span>
        );
      })}
    </div>
  );
}
