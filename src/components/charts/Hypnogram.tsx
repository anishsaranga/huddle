"use client";

import { motion, useReducedMotion } from "motion/react";
import { useId } from "react";
import { STAGE_COLORS, STAGE_LABELS, STAGE_ORDER, type SleepStage } from "@/lib/ui/colors";
import { ease } from "@/lib/ui/motion";

export type SleepSegment = {
  stage: SleepStage;
  /** Any consistent unit (minutes since bedtime, epoch ms…). */
  start: number;
  end: number;
};

type HypnogramProps = {
  segments: SleepSegment[];
  /** Axis labels for the start/end of the night, e.g. "11:42 PM". */
  startLabel?: string;
  endLabel?: string;
  /** Shorter rows for cards. */
  compact?: boolean;
  ariaLabel: string;
  delay?: number;
  className?: string;
};

const W = 300;

/**
 * Sleep-stage stepped chart. Stage bars sit on four rows (Awake/REM/Core/Deep)
 * joined by hairline risers; the whole thing is revealed left→right by an
 * animated clip, like a trace being written.
 */
export function Hypnogram({
  segments,
  startLabel,
  endLabel,
  compact = false,
  ariaLabel,
  delay = 0,
  className = "",
}: HypnogramProps) {
  const reduced = useReducedMotion();
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  if (segments.length === 0) return null;

  const rowH = compact ? 22 : 30;
  const H = rowH * STAGE_ORDER.length;
  const bar = compact ? 7 : 9;
  const t0 = Math.min(...segments.map((s) => s.start));
  const t1 = Math.max(...segments.map((s) => s.end));
  const x = (t: number) => ((t - t0) / (t1 - t0 || 1)) * W;
  const rowY = (s: SleepStage) => STAGE_ORDER.indexOf(s) * rowH + rowH / 2;

  const sorted = [...segments].sort((a, b) => a.start - b.start);
  let riser = "";
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (a.stage === b.stage) continue;
    const xx = x(b.start);
    riser += `M${xx},${rowY(a.stage)} L${xx},${rowY(b.stage)} `;
  }

  const reveal = reduced ? { duration: 0 } : { duration: 1.4, delay, ease: ease.out };

  return (
    <figure className={className} role="img" aria-label={ariaLabel}>
      <div className="flex gap-3">
        <div aria-hidden className="flex w-10 shrink-0 flex-col">
          {STAGE_ORDER.map((s) => (
            <span
              key={s}
              className="telemetry flex items-center text-[9.5px]"
              style={{ height: rowH }}
            >
              {STAGE_LABELS[s]}
            </span>
          ))}
        </div>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="block min-w-0 flex-1 overflow-visible"
          style={{ height: H }}
          aria-hidden
        >
          <defs>
            <clipPath id={`clip${uid}`}>
              <motion.rect
                x={0}
                y={-10}
                height={H + 20}
                initial={{ width: 0 }}
                animate={{ width: W }}
                transition={reveal}
              />
            </clipPath>
          </defs>
          {STAGE_ORDER.map((s) => (
            <line
              key={s}
              x1={0}
              x2={W}
              y1={rowY(s)}
              y2={rowY(s)}
              style={{ stroke: "rgba(255,255,255,0.05)" }}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <g clipPath={`url(#clip${uid})`}>
            <path
              d={riser}
              fill="none"
              style={{ stroke: "rgba(255,255,255,0.22)" }}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
            {sorted.map((s, i) => (
              <rect
                key={i}
                x={x(s.start)}
                y={rowY(s.stage) - bar / 2}
                width={Math.max(x(s.end) - x(s.start), 0.8)}
                height={bar}
                rx={1.5}
                style={{ fill: STAGE_COLORS[s.stage] }}
              />
            ))}
          </g>
        </svg>
      </div>
      {(startLabel || endLabel) && (
        <figcaption aria-hidden className="mt-2 flex justify-between pl-[52px]">
          <span className="telemetry text-[9.5px]">{startLabel}</span>
          <span className="telemetry text-[9.5px]">{endLabel}</span>
        </figcaption>
      )}
    </figure>
  );
}
