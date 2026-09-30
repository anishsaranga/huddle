import type { CSSProperties } from "react";
import { SIGNAL } from "@/lib/ui/colors";

/** Same geometry as public/icons/icon.svg (512 box), without the background. */
const RINGS = [
  { cx: 256, cy: 196, color: SIGNAL.green },
  { cx: 196, cy: 300, color: SIGNAL.strain },
  { cx: 316, cy: 300, color: SIGNAL.sleep },
] as const;

type HuddleMarkProps = {
  size?: number;
  /** Draw the rings in (staggered stroke sweep) on load. */
  animate?: boolean;
  /** Seconds before the first ring starts. */
  delay?: number;
  className?: string;
};

/**
 * The three-ring Huddle mark: recovery, strain and sleep overlapping.
 * Rings sweep in one after another like the overview dials. The sweep is a CSS
 * animation (`.mark-ring`, globals.css) so the rings are in the server HTML and
 * stay visible if JavaScript is slow or missing.
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
        <circle
          key={i}
          cx={r.cx}
          cy={r.cy}
          r={92}
          fill="none"
          strokeWidth={34}
          strokeLinecap="round"
          // Normalised length so the dash sweep is one unit; start each sweep at 12 o'clock.
          pathLength={1}
          transform={`rotate(-90 ${r.cx} ${r.cy})`}
          className={animate ? "mark-ring" : undefined}
          style={{ stroke: r.color, ...(animate ? ({ "--mark-delay": `${delay + i * 0.12}s` } as CSSProperties) : null) }}
        />
      ))}
    </svg>
  );
}
