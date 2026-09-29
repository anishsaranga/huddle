"use client";

import { motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { Hypnogram, type SleepSegment } from "@/components/charts/Hypnogram";
import { formatDuration } from "@/lib/dashboard/format";
import type { BedtimeChart as BedtimeChartData, StageRow } from "@/lib/dashboard/sleep-view";
import { STAGE_COLORS, STAGE_LABELS, type SleepStage } from "@/lib/ui/colors";
import { ease, spring } from "@/lib/ui/motion";

/**
 * Full-width hypnogram with the stage breakdown underneath. The breakdown
 * rows double as the legend: tap one to highlight that stage in the chart.
 */
export function SleepStages({
  segments,
  rows,
  startLabel,
  endLabel,
  ariaLabel,
}: {
  segments: SleepSegment[];
  rows: StageRow[];
  startLabel: string;
  endLabel: string;
  ariaLabel: string;
}) {
  const reduced = useReducedMotion();
  const [focus, setFocus] = useState<SleepStage | null>(null);
  const maxPct = Math.max(...rows.map((r) => r.pct), 1);

  return (
    <div>
      <Hypnogram segments={segments} startLabel={startLabel} endLabel={endLabel} ariaLabel={ariaLabel} highlight={focus} delay={0.25} />
      <ul className="mt-5 space-y-1" aria-label="Time in each stage">
        {rows.map((r, i) => {
          const on = focus === r.stage;
          const dim = focus !== null && !on;
          return (
            <li key={r.stage}>
              <motion.button
                type="button"
                aria-pressed={on}
                onClick={() => setFocus(on ? null : r.stage)}
                whileTap={{ scale: 0.98 }}
                transition={spring.press}
                className={`grid w-full grid-cols-[62px_1fr_62px_38px] items-center gap-3 rounded-xl px-2 py-2 text-left transition-[opacity,background-color] duration-200 ${
                  on ? "bg-white/[0.05]" : ""
                }`}
                style={{ opacity: dim ? 0.4 : 1 }}
              >
                <span className="flex items-center gap-2">
                  <span className="size-2 rounded-[3px]" style={{ background: STAGE_COLORS[r.stage] }} />
                  <span className="text-[14px] font-medium">{STAGE_LABELS[r.stage]}</span>
                </span>
                <span className="relative h-[6px] rounded-full bg-white/[0.05]">
                  <motion.span
                    className="absolute inset-y-0 left-0 origin-left rounded-full"
                    style={{ width: `${(r.pct / maxPct) * 100}%`, background: STAGE_COLORS[r.stage] }}
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={reduced ? { duration: 0 } : { duration: 0.8, delay: 0.5 + i * 0.06, ease: ease.outExpo }}
                  />
                </span>
                <span className="num text-right font-mono text-[12px] text-text-2">{formatDuration(r.minutes)}</span>
                <span className="num text-right font-mono text-[12px] text-muted">{r.pct}%</span>
              </motion.button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Last 7 nights as floating bed → wake bars on a clock axis, with dashed average bed / wake lines. */
export function BedtimeChart({ data, ariaLabel }: { data: BedtimeChartData; ariaLabel: string }) {
  const reduced = useReducedMotion();
  const { rows, lo, hi, ticks, meanBed, meanWake } = data;
  const x = (t: number) => ((t - lo) / (hi - lo || 1)) * 100;

  return (
    <figure role="img" aria-label={ariaLabel}>
      <div className="relative ml-10">
        {ticks.map((t) => (
          <span key={t.t} aria-hidden className="absolute inset-y-0 w-px bg-white/[0.05]" style={{ left: `${x(t.t)}%` }} />
        ))}
        {[meanBed, meanWake].map((m, i) =>
          m === null ? null : (
            <span
              key={i}
              aria-hidden
              className="absolute -inset-y-1 z-10 border-l border-dashed border-white/30"
              style={{ left: `${x(m)}%` }}
            />
          ),
        )}
        <div className="relative space-y-[7px] py-1">
          {rows.map((r, i) => (
            <div key={r.date} className="relative h-[14px]">
              <span
                aria-hidden
                className={`telemetry absolute -left-10 top-1/2 w-8 -translate-y-1/2 text-[9.5px] ${r.current ? "text-text" : ""}`}
              >
                {r.label}
              </span>
              {r.bed !== null && r.wake !== null ? (
                <motion.span
                  className="absolute inset-y-0 origin-left rounded-full"
                  style={{
                    left: `${x(r.bed)}%`,
                    width: `${Math.max(x(r.wake) - x(r.bed), 1)}%`,
                    background: r.current
                      ? "linear-gradient(90deg, var(--stage-core), var(--stage-rem))"
                      : "color-mix(in srgb, var(--sleep) 42%, transparent)",
                    boxShadow: r.current ? "0 0 12px -2px color-mix(in srgb, var(--sleep) 70%, transparent)" : undefined,
                  }}
                  initial={{ scaleX: 0, opacity: 0 }}
                  animate={{ scaleX: 1, opacity: 1 }}
                  transition={reduced ? { duration: 0 } : { duration: 0.7, delay: 0.3 + i * 0.06, ease: ease.outExpo }}
                />
              ) : (
                <span aria-hidden className="absolute inset-x-0 top-1/2 border-t border-dashed border-white/[0.08]" />
              )}
            </div>
          ))}
        </div>
      </div>
      <figcaption aria-hidden className="relative ml-10 mt-2 h-3">
        {ticks.map((t) => (
          <span key={t.t} className="telemetry absolute -translate-x-1/2 text-[9.5px]" style={{ left: `${x(t.t)}%` }}>
            {t.label}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
