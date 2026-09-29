"use client";

import { motion } from "motion/react";
import { formatNumber } from "@/lib/ui/format";
import { spring } from "@/lib/ui/motion";

export type TrendBar = {
  label: string;
  value: number;
  /** Per-bar color; wins over the `color` prop. Serializable, so server pages can precompute it. */
  color?: string;
};

type TrendBarsProps = {
  data: TrendBar[];
  /** Scale maximum. Default: max of data. */
  max?: number;
  /** Fallback color, or a function of (value, index) when called from client code. */
  color?: string | ((value: number, index: number) => string);
  /** Dashed reference line, e.g. 30-day average. */
  baseline?: number;
  baselineLabel?: string;
  /** Show values above bars. */
  showValues?: boolean;
  decimals?: number;
  height?: number;
  ariaLabel: string;
  /** Seconds. */
  delay?: number;
  className?: string;
};

/** Vertical bars that grow up in a stagger (scaleY — transform only). */
export function TrendBars({
  data,
  max,
  color = "var(--strain)",
  baseline,
  baselineLabel,
  showValues = false,
  decimals = 0,
  height = 120,
  ariaLabel,
  delay = 0,
  className = "",
}: TrendBarsProps) {
  const top = max ?? Math.max(...data.map((d) => d.value), baseline ?? 0, 1);
  const pct = (v: number) => Math.min(Math.max(v / top, 0), 1) * 100;
  const colorOf = (d: TrendBar, i: number) =>
    d.color ?? (typeof color === "function" ? color(d.value, i) : color);
  const stagger = Math.min(0.05, 0.6 / Math.max(data.length, 1));

  return (
    <figure className={className} role="img" aria-label={ariaLabel}>
      <div className="relative" style={{ height }}>
        {typeof baseline === "number" && (
          <div
            aria-hidden
            className="absolute inset-x-0 z-10 border-t border-dashed border-white/25"
            style={{ bottom: `${pct(baseline)}%` }}
          >
            {baselineLabel && (
              <span className="telemetry absolute -top-[15px] right-0 bg-card pl-1 text-[9.5px]">
                {baselineLabel}
              </span>
            )}
          </div>
        )}
        <div className="absolute inset-0 flex items-end gap-[5px]">
          {data.map((d, i) => {
            const c = colorOf(d, i);
            return (
              <div key={`${d.label}-${i}`} className="relative flex h-full flex-1 items-end">
                <motion.div
                  className="relative w-full origin-bottom rounded-t-[4px] rounded-b-[2px]"
                  style={{
                    height: `${Math.max(pct(d.value), 1.5)}%`,
                    background: `linear-gradient(180deg, ${c}, color-mix(in srgb, ${c} 55%, transparent))`,
                    boxShadow: `0 0 12px -2px color-mix(in srgb, ${c} 45%, transparent)`,
                  }}
                  initial={{ scaleY: 0, opacity: 0 }}
                  animate={{ scaleY: 1, opacity: 1 }}
                  transition={{
                    scaleY: { ...spring.soft, delay: delay + i * stagger },
                    opacity: { duration: 0.2, delay: delay + i * stagger },
                  }}
                >
                  {showValues && (
                    <span className="num absolute inset-x-0 -top-5 text-center font-display text-[13px] font-semibold text-text-2">
                      {formatNumber(d.value, decimals)}
                    </span>
                  )}
                </motion.div>
              </div>
            );
          })}
        </div>
      </div>
      <figcaption aria-hidden className="mt-2 flex gap-[5px]">
        {data.map((d, i) => (
          <span key={`${d.label}-${i}`} className="telemetry flex-1 text-center text-[9.5px]">
            {d.label}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
