"use client";

import { motion } from "motion/react";
import { spring } from "@/lib/ui/motion";

export type HourPoint = { hour: number; min: number; max: number; avg: number } | null;

type HourBarsProps = {
  /** 24 entries (index = hour 0–23); null = no data yet (e.g. future hours). */
  data: HourPoint[];
  color?: string;
  height?: number;
  /** Y-axis domain. Default: padded min/max of the data. */
  domain?: [number, number];
  ariaLabel: string;
  delay?: number;
  className?: string;
};

const AXIS = [
  { h: 0, label: "12A" },
  { h: 6, label: "6A" },
  { h: 12, label: "12P" },
  { h: 18, label: "6P" },
];

/**
 * 24 hourly heart-rate range capsules (min→max) with an average tick.
 * Capsules grow from their center (scaleY) in a quick left→right stagger.
 */
export function HourBars({
  data,
  color = "var(--strain)",
  height = 112,
  domain,
  ariaLabel,
  delay = 0,
  className = "",
}: HourBarsProps) {
  const present = data.filter((d): d is NonNullable<HourPoint> => d !== null);
  const lo = domain?.[0] ?? Math.floor((Math.min(...present.map((d) => d.min)) - 5) / 10) * 10;
  const hi = domain?.[1] ?? Math.ceil((Math.max(...present.map((d) => d.max)) + 5) / 10) * 10;
  const y = (v: number) => ((v - lo) / (hi - lo || 1)) * 100;

  return (
    <figure className={className} role="img" aria-label={ariaLabel}>
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
                    className="absolute bottom-0 left-1/2 size-[3px] -translate-x-1/2 rounded-full bg-white/10"
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
        {Array.from({ length: 24 }, (_, h) => {
          const tick = AXIS.find((a) => a.h === h);
          return (
            <span key={h} className="telemetry relative flex-1 text-[9.5px]">
              {tick && <span className="absolute left-0 -translate-x-[2px]">{tick.label}</span>}
            </span>
          );
        })}
      </figcaption>
    </figure>
  );
}
