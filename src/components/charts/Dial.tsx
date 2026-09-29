"use client";

import { motion, useReducedMotion } from "motion/react";
import { useId, type ReactNode } from "react";
import { CountUp } from "@/components/ui/CountUp";
import { alpha } from "@/lib/ui/colors";
import { formatNumber } from "@/lib/ui/format";
import { spring } from "@/lib/ui/motion";

export type DialSize = "sm" | "md" | "lg";

type DialProps = {
  /** Current value. Clamped to [0, max]. */
  value: number;
  /** Value at which the ring is full. */
  max: number;
  /** Ring color (any CSS color, e.g. "var(--recovery-green)"). */
  color: string;
  /** ALL-CAPS label (below the ring for md, inside for lg; aria-only for sm). */
  label: string;
  /** "percent" → 72%, "decimal" → 11.4, "integer" → 72. Default "integer". */
  format?: "percent" | "decimal" | "integer";
  /** Override decimals (defaults: decimal → 1, else 0). */
  decimals?: number;
  /** Static center text (skips the count-up). Kept for backward compatibility. */
  display?: string;
  /** Preset size, or a pixel diameter (treated as md styling). */
  size?: DialSize | number;
  /** Secondary line inside the lg dial, e.g. "HRV 68 MS". */
  sublabel?: string;
  /** Faint bezel ticks inside the ring. Default: on for lg. */
  ticks?: boolean;
  /** Seconds before the sweep starts. */
  delay?: number;
  /** No value: dashed hollow track and a dimmed center (pair with display="—"). */
  hollow?: boolean;
  /** Extra line(s) under the md label (reason, LIMITED chip, LIVE dot). */
  footer?: ReactNode;
  /** Hide the md label (for rings used as inline gauges). */
  hideLabel?: boolean;
  /** Replaces the generated accessible name. */
  ariaLabel?: string;
  className?: string;
};

// Trig results can differ in the last ulp between Node and browsers; round to
// keep SSR and hydration attributes identical.
const r2 = (n: number) => Math.round(n * 100) / 100;

const PRESETS: Record<DialSize, { px: number; stroke: number; font: number }> = {
  sm: { px: 44, stroke: 4, font: 15 },
  md: { px: 104, stroke: 7, font: 36 },
  lg: { px: 220, stroke: 12, font: 76 },
};

/**
 * Ring dial. The arc sweeps from 0 with a spring on mount (and from the
 * previous value on change), the numeral counts up in lockstep, a bright
 * end-cap dot rides the arc tip, and a soft glow of the ring color sits
 * behind it. Only stroke (pathLength), transform and opacity animate.
 */
export function Dial({
  value,
  max,
  color,
  label,
  format = "integer",
  decimals,
  display,
  size = "md",
  sublabel,
  ticks,
  delay = 0,
  hollow = false,
  footer,
  hideLabel = false,
  ariaLabel,
  className = "",
}: DialProps) {
  const reduced = useReducedMotion();
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");

  const variant: DialSize = typeof size === "number" ? "md" : size;
  const preset =
    typeof size === "number"
      ? {
          px: size,
          stroke: Math.max(4, Math.round(size * 0.07)),
          font: Math.round(size * 0.34),
        }
      : PRESETS[size];
  const { px, stroke, font } = preset;
  const showTicks = ticks ?? variant === "lg";
  const glow = variant !== "sm";

  const center = px / 2;
  const radius = (px - stroke) / 2 - (glow ? 1 : 0);
  const ratio =
    max > 0 && Number.isFinite(value) ? Math.min(Math.max(value / max, 0), 1) : 0;

  const places = decimals ?? (format === "decimal" ? 1 : 0);
  const suffix = format === "percent" ? "%" : "";
  const spoken = display ?? `${formatNumber(value, places)}${suffix}`;

  const transition = reduced ? { duration: 0 } : { ...spring.dial, delay };
  const fade = reduced ? { duration: 0 } : { duration: 0.25, delay };

  // Ticks sit inside the ring like an instrument bezel.
  const tickCount = 72;
  const tickOuter = radius - stroke / 2 - 5;
  const tickInner = tickOuter - (variant === "lg" ? 6 : 3);

  return (
    <div
      className={`flex flex-col items-center gap-2.5 ${className}`}
      role="img"
      style={{ "--dial-color": color } as React.CSSProperties}
      aria-label={ariaLabel ?? `${label}: ${spoken}${sublabel ? `, ${sublabel}` : ""}`}
    >
      <div className="relative" style={{ width: px, height: px }}>
        {glow && (
          <motion.div
            aria-hidden
            className="pointer-events-none absolute -inset-[22%]"
            initial={{ opacity: 0 }}
            animate={{ opacity: ratio > 0 ? 1 : 0 }}
            transition={reduced ? { duration: 0 } : { duration: 1.2, delay: delay + 0.1 }}
          >
            {/* Plain element so color changes apply immediately (motion owns only opacity). */}
            <div
              className="absolute inset-0 rounded-full"
              style={{
                background: `radial-gradient(circle, ${alpha(color, 18)} 0%, ${alpha(color, 6)} 45%, transparent 68%)`,
              }}
            />
          </motion.div>
        )}

        <svg
          width={px}
          height={px}
          viewBox={`0 0 ${px} ${px}`}
          className="relative -rotate-90 overflow-visible"
          aria-hidden="true"
        >
          {glow && (
            <defs>
              <filter id={`glow${uid}`} x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur stdDeviation={stroke * 0.9} />
              </filter>
            </defs>
          )}

          {showTicks &&
            Array.from({ length: tickCount }, (_, i) => {
              const a = (i / tickCount) * Math.PI * 2;
              const major = i % 6 === 0;
              const inner = major ? tickInner - 2 : tickInner;
              return (
                <line
                  key={i}
                  x1={r2(center + Math.cos(a) * inner)}
                  y1={r2(center + Math.sin(a) * inner)}
                  x2={r2(center + Math.cos(a) * tickOuter)}
                  y2={r2(center + Math.sin(a) * tickOuter)}
                  style={{
                    stroke: major ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.08)",
                  }}
                  strokeWidth={1}
                  strokeLinecap="round"
                />
              );
            })}

          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            style={{ stroke: hollow ? "rgba(255,255,255,0.2)" : "var(--track)" }}
            strokeWidth={hollow ? Math.max(1.5, r2(stroke * 0.3)) : stroke}
            strokeDasharray={hollow ? `${r2(stroke * 0.3)} ${r2(stroke * 0.95)}` : undefined}
            strokeLinecap={hollow ? "round" : undefined}
          />

          {glow && (
            <motion.circle
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              className="[stroke:var(--dial-color)] transition-[stroke] duration-700"
              strokeWidth={stroke}
              strokeLinecap="round"
              filter={`url(#glow${uid})`}
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: ratio, opacity: ratio > 0 ? 0.55 : 0 }}
              transition={{ pathLength: transition, opacity: fade }}
            />
          )}

          <motion.circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            className="[stroke:var(--dial-color)] transition-[stroke] duration-700"
            strokeWidth={stroke}
            strokeLinecap="round"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: ratio, opacity: ratio > 0 ? 1 : 0 }}
            transition={{ pathLength: transition, opacity: fade }}
          />
        </svg>

        {/* End-cap dot: a full-size layer rotated to the arc tip. */}
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          initial={{ rotate: 0, opacity: 0 }}
          animate={{ rotate: ratio * 360, opacity: ratio > 0 ? 1 : 0 }}
          transition={{ rotate: transition, opacity: fade }}
        >
          <span
            className="absolute left-1/2 rounded-full bg-white"
            style={{
              width: Math.max(2, stroke * 0.5),
              height: Math.max(2, stroke * 0.5),
              top: stroke / 2 + (glow ? 1 : 0),
              transform: "translate(-50%, -50%)",
              boxShadow: glow ? `0 0 ${stroke}px ${color}, 0 0 2px #fff` : undefined,
            }}
          />
        </motion.div>

        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            className={`font-display font-semibold leading-none ${hollow ? "text-dim" : "text-text"}`}
            style={{ fontSize: font, letterSpacing: variant === "sm" ? 0 : "0.01em" }}
          >
            {display !== undefined ? (
              <span className="num">{display}</span>
            ) : (
              <CountUp
                value={value}
                decimals={places}
                suffix={variant === "sm" ? "" : suffix}
                delay={delay}
                duration={1.15}
                suffixClassName="ml-[0.04em] text-[0.5em] font-semibold text-text-2 align-[0.62em]"
              />
            )}
          </span>
          {variant === "lg" && (
            <>
              <span className="label mt-2 text-text-2">{label}</span>
              {sublabel && <span className="telemetry mt-1.5">{sublabel}</span>}
            </>
          )}
        </div>
      </div>
      {variant === "md" && !hideLabel && <span className="label">{label}</span>}
      {variant === "md" && footer}
    </div>
  );
}
