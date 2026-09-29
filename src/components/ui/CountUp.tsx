"use client";

import { animate, useReducedMotion } from "motion/react";
import { useEffect, useRef } from "react";
import { formatNumber } from "@/lib/ui/format";
import { ease } from "@/lib/ui/motion";

type CountUpProps = {
  /** Target value. */
  value: number;
  /** Starting value on first mount. Later changes animate from the previous value. */
  from?: number;
  decimals?: number;
  /** Seconds. */
  duration?: number;
  /** Seconds. */
  delay?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
  suffixClassName?: string;
};

/**
 * Animated number. Writes text straight to the DOM each frame (no React
 * re-renders); tabular numerals keep width stable while counting. Screen
 * readers get the final value only.
 */
export function CountUp({
  value,
  from = 0,
  decimals = 0,
  duration = 1.1,
  delay = 0,
  prefix = "",
  suffix = "",
  className = "",
  suffixClassName = "",
}: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const current = useRef(from);
  const reduced = useReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const write = (v: number) => {
      current.current = v;
      el.textContent = formatNumber(v, decimals);
    };
    if (reduced || current.current === value) {
      write(value);
      return;
    }
    const controls = animate(current.current, value, {
      duration,
      delay,
      ease: ease.outExpo,
      onUpdate: write,
    });
    return () => controls.stop();
  }, [value, decimals, duration, delay, reduced]);

  const final = `${prefix}${formatNumber(value, decimals)}${suffix}`;

  return (
    <span className={`num ${className}`}>
      <span aria-hidden>
        {prefix}
        <span ref={ref}>{formatNumber(from, decimals)}</span>
        {suffix && <span className={suffixClassName}>{suffix}</span>}
      </span>
      <span className="sr-only">{final}</span>
    </span>
  );
}
