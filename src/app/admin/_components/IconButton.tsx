"use client";

import { motion } from "motion/react";
import type { ReactNode } from "react";
import { PRESS_SCALE, spring } from "@/lib/ui/motion";

type IconButtonProps = {
  label: string;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
  danger?: boolean;
};

/** 44px touch target with a smaller visual chip and press-scale feedback. */
export function IconButton({ label, onClick, children, disabled, danger }: IconButtonProps) {
  return (
    <motion.button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      whileTap={disabled ? undefined : { scale: PRESS_SCALE }}
      transition={spring.press}
      className="-mr-1.5 flex size-11 shrink-0 items-center justify-center rounded-full disabled:opacity-40"
    >
      <span
        className={`flex size-9 items-center justify-center rounded-full bg-white/[0.04] shadow-[inset_0_0_0_1px_var(--hairline)] ${
          danger ? "text-recovery-red" : "text-text-2"
        }`}
      >
        {children}
      </span>
    </motion.button>
  );
}

const icon = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

export const TrashIcon = () => (
  <svg {...icon}>
    <path d="M4 7h16" />
    <path d="M9 7V4.5h6V7" />
    <path d="M6.5 7l.8 12a1 1 0 0 0 1 .9h7.4a1 1 0 0 0 1-.9l.8-12" />
    <path d="M10 11v5M14 11v5" />
  </svg>
);

export const MinusIcon = () => (
  <svg {...icon}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M8.5 12h7" />
  </svg>
);

export const LockIcon = () => (
  <svg {...icon}>
    <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
    <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
  </svg>
);

export const PlusIcon = () => (
  <svg {...icon}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);
