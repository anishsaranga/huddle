"use client";

import { motion, useReducedMotion } from "motion/react";
import { useId } from "react";
import { ease } from "@/lib/ui/motion";

type SparklineProps = {
  data: number[];
  color?: string;
  /** Nominal viewBox size; the SVG scales uniformly to its container width. */
  width?: number;
  height?: number;
  strokeWidth?: number;
  /** Accessible summary, e.g. "HRV, last 14 days, 48 to 71 ms". */
  ariaLabel: string;
  /** Seconds. */
  delay?: number;
  className?: string;
};

/**
 * Line draws on (pathLength), gradient fill fades in underneath, last point
 * gets a dot with a slow pulse ring.
 */
export function Sparkline({
  data,
  color = "var(--strain)",
  width = 320,
  height = 64,
  strokeWidth = 2,
  ariaLabel,
  delay = 0,
  className = "",
}: SparklineProps) {
  const reduced = useReducedMotion();
  const gid = `spark${useId().replace(/[^a-zA-Z0-9]/g, "")}`;

  if (data.length < 2) return null;

  const pad = 6;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => [
    pad + (i / (data.length - 1)) * (width - pad * 2),
    pad + (1 - (v - min) / span) * (height - pad * 2),
  ]);

  // Smooth with a light cardinal spline (tension .2) so it reads premium, not jagged.
  let line = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const t = 0.2;
    const c1 = [p1[0] + (p2[0] - p0[0]) * t, p1[1] + (p2[1] - p0[1]) * t];
    const c2 = [p2[0] - (p3[0] - p1[0]) * t, p2[1] - (p3[1] - p1[1]) * t];
    line += ` C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${p2[0]},${p2[1]}`;
  }
  const last = pts[pts.length - 1];
  const area = `${line} L${last[0]},${height} L${pts[0][0]},${height} Z`;

  const draw = reduced ? { duration: 0 } : { duration: 1.1, delay, ease: ease.outExpo };
  const after = reduced ? { duration: 0 } : { duration: 0.5, delay: delay + 0.7 };

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={`block h-auto w-full overflow-visible ${className}`}
      role="img"
      aria-label={ariaLabel}
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" style={{ stopColor: color, stopOpacity: 0.28 }} />
          <stop offset="100%" style={{ stopColor: color, stopOpacity: 0 }} />
        </linearGradient>
      </defs>
      <motion.path
        d={area}
        fill={`url(#${gid})`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={after}
      />
      <motion.path
        d={line}
        fill="none"
        style={{ stroke: color }}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={draw}
      />
      <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={after}>
        <circle
          className="animate-dot-pulse"
          cx={last[0]}
          cy={last[1]}
          r={strokeWidth * 1.8}
          style={{ fill: color }}
        />
        <circle cx={last[0]} cy={last[1]} r={strokeWidth * 1.8} style={{ fill: color }} />
        <circle cx={last[0]} cy={last[1]} r={strokeWidth * 0.8} fill="#fff" />
      </motion.g>
    </svg>
  );
}
