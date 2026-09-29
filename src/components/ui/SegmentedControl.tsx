"use client";

import { motion } from "motion/react";
import { useId } from "react";
import { spring } from "@/lib/ui/motion";

export type SegmentOption<T extends string> = { value: T; label: string };

type SegmentedControlProps<T extends string> = {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name for the group, e.g. "Range". */
  ariaLabel: string;
  size?: "sm" | "md";
  className?: string;
};

/** Pill segmented control; the active pill slides between options (layoutId). */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  size = "md",
  className = "",
}: SegmentedControlProps<T>) {
  const layoutId = `seg-${useId()}`;
  const h = size === "sm" ? "h-8" : "h-10";
  const text = size === "sm" ? "text-[11px]" : "text-[12px]";

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={`nav-chrome relative flex rounded-full bg-card-sunken p-1 shadow-[inset_0_1px_2px_rgb(0_0_0/0.5),inset_0_0_0_1px_var(--hairline)] ${className}`}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <motion.button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            whileTap={{ scale: 0.95 }}
            transition={spring.press}
            className={`relative flex-1 rounded-full px-3 ${h} ${text} font-semibold uppercase tracking-[0.12em] transition-colors duration-200 ${
              active ? "text-bg" : "text-muted"
            }`}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                aria-hidden
                className="absolute inset-0 rounded-full bg-white shadow-[0_1px_8px_rgb(255_255_255/0.18)]"
                transition={spring.snappy}
              />
            )}
            <span className="relative">{opt.label}</span>
          </motion.button>
        );
      })}
    </div>
  );
}
