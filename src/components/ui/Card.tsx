"use client";

import Link from "next/link";
import { motion } from "motion/react";
import type { ReactNode } from "react";
import { alpha } from "@/lib/ui/colors";
import { PRESS_SCALE, spring } from "@/lib/ui/motion";

type CardProps = {
  children: ReactNode;
  variant?: "default" | "elevated" | "interactive";
  /** Tints the top edge and adds a faint wash of this color. */
  glow?: string;
  /** Interactive only: show a trailing chevron. */
  chevron?: boolean;
  /** Interactive only: navigate on tap. */
  href?: string;
  /** Interactive only. */
  onClick?: () => void;
  /** Accessible name for interactive cards whose content isn't a clear label. */
  ariaLabel?: string;
  className?: string;
  /** Padding classes. Default "p-5". */
  padding?: string;
};

const MotionLink = motion.create(Link);

/**
 * Instrument-panel surface: top-lit gradient edge, inner shadow, soft drop.
 * `interactive` adds a press-scale spring (touch — no hover effects).
 */
export function Card({
  children,
  variant = "default",
  glow,
  chevron,
  href,
  onClick,
  ariaLabel,
  className = "",
  padding = "p-5",
}: CardProps) {
  const surface = `surface ${variant === "elevated" ? "surface-elevated" : ""} block ${padding} ${className}`;

  const inner = (
    <>
      {glow && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]"
        >
          <div
            className="absolute inset-x-6 top-0 h-px"
            style={{
              background: `linear-gradient(90deg, transparent, ${alpha(glow, 80)}, transparent)`,
            }}
          />
          <div
            className="absolute inset-x-0 -top-16 h-32"
            style={{
              background: `radial-gradient(ellipse 60% 100% at 50% 0%, ${alpha(glow, 14)}, transparent 70%)`,
            }}
          />
        </div>
      )}
      {chevron ? (
        <div className="relative flex items-center gap-3">
          <div className="min-w-0 flex-1">{children}</div>
          <svg
            aria-hidden
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="shrink-0 text-dim"
          >
            <path d="m6 3.5 4.5 4.5L6 12.5" />
          </svg>
        </div>
      ) : (
        <div className="relative">{children}</div>
      )}
    </>
  );

  if (variant !== "interactive") {
    return <div className={surface}>{inner}</div>;
  }

  const press = { whileTap: { scale: PRESS_SCALE }, transition: spring.press };

  if (href) {
    return (
      <MotionLink href={href} aria-label={ariaLabel} className={surface} {...press}>
        {inner}
      </MotionLink>
    );
  }

  return (
    <motion.button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={`${surface} w-full text-left`}
      {...press}
    >
      {inner}
    </motion.button>
  );
}
