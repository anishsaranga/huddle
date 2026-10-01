"use client";

import { AnimatePresence, motion } from "motion/react";
import { alpha } from "@/lib/ui/colors";

type AmbientGlowProps = {
  /** Any CSS color, e.g. recoveryColor(72). Changing it crossfades. */
  color: string;
  /** 0–1 multiplier on the wash strength. Default 1. */
  intensity?: number;
  /** Film-grain overlay. Default true. */
  grain?: boolean;
  className?: string;
};

/**
 * Signature backdrop: a large soft radial wash that bleeds down from the top
 * and slowly breathes (~6s, compositor-only CSS keyframes), under a faint
 * film-grain layer. Place as the first child of a `relative isolate`
 * container; it sits behind the content (-z-10) and never takes input.
 */
export function AmbientGlow({
  color,
  intensity = 1,
  grain = true,
  className = "",
}: AmbientGlowProps) {
  const k = Math.min(Math.max(intensity, 0), 1.5);

  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-y-0 left-1/2 -z-10 w-screen -translate-x-1/2 overflow-hidden ${className}`}
    >
      <AnimatePresence initial={false}>
        <motion.div
          key={color}
          className="absolute inset-x-0 top-0 h-[620px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.9, ease: "easeInOut" }}
        >
          <div
            className="animate-breathe absolute left-1/2 -top-[120px] h-[680px] w-[min(160vw,760px)] -translate-x-1/2"
            style={{
              background: [
                `radial-gradient(ellipse 50% 42% at 50% 30%, ${alpha(color, 26 * k)} 0%, transparent 100%)`,
                `radial-gradient(ellipse 72% 60% at 50% 18%, ${alpha(color, 14 * k)} 0%, ${alpha(color, 5 * k)} 55%, transparent 100%)`,
              ].join(", "),
            }}
          />
        </motion.div>
      </AnimatePresence>
      {grain && <div className="grain fixed inset-x-0 top-0 bottom-app opacity-[0.04]" />}
    </div>
  );
}
