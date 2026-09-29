"use client";

import { motion, type HTMLMotionProps } from "motion/react";
import type { ReactNode } from "react";
import { alpha } from "@/lib/ui/colors";
import { PRESS_SCALE, spring } from "@/lib/ui/motion";

type ButtonProps = Omit<HTMLMotionProps<"button">, "children" | "color"> & {
  children?: ReactNode;
  /** primary = white on ink; signal = colored with glow; secondary = hairline; ghost = text only. */
  variant?: "primary" | "signal" | "secondary" | "ghost";
  size?: "sm" | "md" | "lg";
  /** Signal variant color. Default strain blue. */
  color?: string;
  loading?: boolean;
  /** Leading icon (hidden while loading). */
  icon?: ReactNode;
  fullWidth?: boolean;
};

const sizes = {
  sm: "h-9 px-3.5 text-[12px] gap-1.5",
  md: "h-11 px-5 text-[13px] gap-2",
  lg: "h-[52px] px-6 text-[14px] gap-2",
};

export function Button({
  children,
  variant = "primary",
  size = "md",
  color = "var(--strain)",
  loading = false,
  icon,
  fullWidth,
  disabled,
  className = "",
  style,
  type = "button",
  ...rest
}: ButtonProps) {
  const base =
    "relative inline-flex select-none items-center justify-center rounded-full font-semibold uppercase tracking-[0.12em] transition-opacity disabled:opacity-40";

  const variants = {
    primary: "bg-white text-bg shadow-[0_1px_0_rgb(255_255_255/0.4)_inset,0_6px_20px_-8px_rgb(255_255_255/0.35)]",
    signal: "text-bg",
    secondary:
      "bg-white/[0.03] text-text shadow-[inset_0_0_0_1px_var(--hairline-strong),inset_0_1px_0_rgb(255_255_255/0.06)]",
    ghost: "text-text-2",
  };

  const signalStyle =
    variant === "signal"
      ? {
          background: color,
          boxShadow: `0 0 0 1px ${alpha(color, 60)} inset, 0 8px 24px -8px ${alpha(color, 70)}`,
        }
      : undefined;

  return (
    <motion.button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      whileTap={disabled || loading ? undefined : { scale: PRESS_SCALE }}
      transition={spring.press}
      className={`${base} ${sizes[size]} ${variants[variant]} ${fullWidth ? "w-full" : ""} ${className}`}
      style={{ ...signalStyle, ...(style as object) }}
      {...rest}
    >
      {loading ? (
        <span
          aria-hidden
          className="animate-spin-fast size-[1.1em] rounded-full border-2 border-current border-r-transparent"
        />
      ) : (
        icon
      )}
      {children && <span>{children}</span>}
    </motion.button>
  );
}
