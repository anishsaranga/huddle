"use client";

import { motion } from "motion/react";
import { spring } from "@/lib/ui/motion";

export type HourPoint = { hour: number; min: number; max: number; avg: number } | null;

type HourBarsProps = {
  /** 24 entries (index = hour 0–23); null = no data (or not yet lived). */
  data: HourPoint[];
  color?: string;
  height?: number;
  /** Y-axis domain. Default: padded min/max of the data. */
  domain?: [number, number];
  /** Current hour on a partial day: later hours render as faint "future" slots behind a NOW rule. */
  nowHour?: number | null;
  /** 12 h axis labels (12A 6A 12P 6P) or 24 h (00 06 12 18). Default true. */
  h12?: boolean;
  ariaLabel: string;
  delay?: number;
  className?: string;
};

const AXIS_HOURS = [0, 6, 12, 18];
const axisLabel = (h: number, h12: boolean) =>
  h12 ? `${h % 12 || 12}${h < 12 ? "A" : "P"}` : String(h).padStart(2, "0");

/**
 * 24 hourly heart-rate range capsules (min→max) with an average tick.
 * Capsules grow from their center (scaleY) in a quick left→right stagger.
 */
export function HourBars({
  data,
  color = "var(--strain)",
  height = 112,
  domain,
  nowHour = null,
  h12 = true,
  ariaLabel,
  delay = 0,
  className = "",
}: HourBarsProps) {
  const present = data.filter((d): d is NonNullable<HourPoint> => d !== null);
  const lo = domain?.[0] ?? (present.length ? Math.floor((Math.min(...present.map((d) => d.min)) - 5) / 10) * 10 : 40);
  const hi = domain?.[1] ?? (present.length ? Math.ceil((Math.max(...present.map((d) => d.max)) + 5) / 10) * 10 : 160);
  const y = (v: number) => ((v - lo) / (hi - lo || 1)) * 100;
  const partial = typeof nowHour === "number";

  return (
    <figure className={className} role="img" aria-label={ariaLabel} style={partial ? { paddingTop: 16 } : undefined}>
      <div className="flex gap-2">
        <div className="relative flex-1" style={{ height }}>
          {/* Grid: three faint rules */}
          {[0, 0.5, 1].map((t) => (
            <div
              key={t}
              aria-hidden
              className="absolute inset-x-0 border-t border-white/[0.05]"
              style={{ bottom: `${t * 100}%` }}
            />
          ))}
          {partial && nowHour < 23 && (
            <>
              {/* Not-yet-lived hours: a faint hatched field after NOW. */}
              <div
                aria-hidden
                className="absolute inset-y-0 right-0 rounded-sm opacity-60"
                style={{
                  left: `${((nowHour + 1) / 24) * 100}%`,
                  background:
                    "repeating-linear-gradient(135deg, rgb(255 255 255 / 0.035) 0 1px, transparent 1px 6px)",
                }}
              />
              <div
                aria-hidden
                className="absolute inset-y-[-6px] w-px bg-white/35"
                style={{ left: `${((nowHour + 1) / 24) * 100}%` }}
              >
                <span className="telemetry absolute -top-[13px] left-1/2 -translate-x-1/2 text-[8.5px] text-text-2">
                  NOW
                </span>
              </div>
            </>
          )}
          <div className="absolute inset-0 flex">
            {data.map((d, i) => (
              <div key={i} className="relative h-full flex-1">
                {d ? (
                  <motion.div
                    className="absolute left-1/2 w-[5px] -translate-x-1/2"
                    style={{ bottom: `${y(d.min)}%`, height: `${Math.max(y(d.max) - y(d.min), 3)}%` }}
                    initial={{ scaleY: 0, opacity: 0 }}
                    animate={{ scaleY: 1, opacity: 1 }}
                    transition={{
                      scaleY: { ...spring.soft, delay: delay + i * 0.018 },
                      opacity: { duration: 0.2, delay: delay + i * 0.018 },
                    }}
                  >
                    <div
                      className="absolute inset-0 rounded-full"
                      style={{
                        background: `linear-gradient(180deg, ${color}, color-mix(in srgb, ${color} 45%, transparent))`,
                        boxShadow: `0 0 8px color-mix(in srgb, ${color} 40%, transparent)`,
                      }}
                    />
                    <div
                      aria-hidden
                      className="absolute left-1/2 h-[2px] w-[9px] -translate-x-1/2 rounded-full bg-white"
                      style={{
                        bottom: `${((d.avg - d.min) / (d.max - d.min || 1)) * 100}%`,
                      }}
                    />
                  </motion.div>
                ) : (
                  <div
                    aria-hidden
                    className={`absolute bottom-0 left-1/2 size-[3px] -translate-x-1/2 rounded-full ${
                      partial && i > (nowHour ?? 23) ? "bg-white/[0.06]" : "bg-white/10"
                    }`}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
        <div aria-hidden className="telemetry flex w-7 flex-col justify-between text-right text-[9.5px]">
          <span>{hi}</span>
          <span>{Math.round((hi + lo) / 2)}</span>
          <span>{lo}</span>
        </div>
      </div>
      <figcaption aria-hidden className="mr-9 mt-2 flex">
        {Array.from({ length: 24 }, (_, h) => (
          <span key={h} className="telemetry relative flex-1 text-[9.5px]">
            {AXIS_HOURS.includes(h) && (
              <span className="absolute left-0 -translate-x-[2px]">{axisLabel(h, h12)}</span>
            )}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
