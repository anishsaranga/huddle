"use client";

import { motion } from "motion/react";
import { SIGNAL } from "@/lib/ui/colors";
import { spring } from "@/lib/ui/motion";

/** Same geometry as public/icons/icon.svg (512 box), without the background. */
const RINGS = [
  { cx: 256, cy: 196, color: SIGNAL.green },
  { cx: 196, cy: 300, color: SIGNAL.strain },
  { cx: 316, cy: 300, color: SIGNAL.sleep },
] as const;

type HuddleMarkProps = {
  size?: number;
  /** Draw the rings in (staggered stroke sweep) on mount. */
  animate?: boolean;
  /** Seconds before the first ring starts. */
  delay?: number;
  className?: string;
};

/**
 * The three-ring Huddle mark: recovery, strain and sleep overlapping.
 * Rings sweep in one after another like the overview dials.
 */
export function HuddleMark({ size = 96, animate = true, delay = 0, className = "" }: HuddleMarkProps) {
  return (
    <svg
      role="img"
      aria-label="Huddle"
      width={size}
      height={size}
      viewBox="84 84 344 344"
      className={`overflow-visible ${className}`}
    >
      {RINGS.map((r, i) => (
        <motion.circle
          key={i}
          cx={r.cx}
          cy={r.cy}
          r={92}
          fill="none"
          strokeWidth={34}
          strokeLinecap="round"
          // Start each sweep at 12 o'clock.
          transform={`rotate(-90 ${r.cx} ${r.cy})`}
          style={{ stroke: r.color }}
          initial={animate ? { pathLength: 0, opacity: 0 } : false}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{
            pathLength: { ...spring.dial, delay: delay + i * 0.12 },
            opacity: { duration: 0.2, delay: delay + i * 0.12 },
          }}
        />
      ))}
    </svg>
  );
}
