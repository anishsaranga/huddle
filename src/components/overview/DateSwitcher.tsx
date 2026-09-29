"use client";

import Link from "next/link";
import { AnimatePresence, motion, type Variants } from "motion/react";
import type { MouseEvent } from "react";
import { spring } from "@/lib/ui/motion";

type DateSwitcherProps = {
  title: string;
  dateLabel: string;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  /** -1 = moved back in time, 1 = forward; drives the slide direction. */
  direction: number;
  /**
   * Optional hrefs for the chevrons: rendered as fully prefetched links (the
   * neighbouring days are ready before the tap); the click still goes through
   * onPrev / onNext so the caller controls the transition.
   */
  prevHref?: string | null;
  nextHref?: string | null;
  /** Tapping the title (e.g. opens a calendar). */
  onTitleClick?: () => void;
  /** A navigation is in flight (dims the date slightly). */
  pending?: boolean;
};

// Older days slide in from the left, newer from the right.
const slide: Variants = {
  enter: (dir: number) => ({ opacity: 0, x: dir * 28 }),
  center: { opacity: 1, x: 0 },
  exit: (dir: number) => ({ opacity: 0, x: dir * -28 }),
};

function Chevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg
      aria-hidden
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={dir === "left" ? "M11 4 6 9l5 5" : "m7 4 5 5-5 5"} />
    </svg>
  );
}

const MotionLink = motion.create(Link);

const btn =
  "grid size-11 place-items-center rounded-full text-text-2 aria-disabled:pointer-events-none aria-disabled:text-dim aria-disabled:opacity-40 disabled:text-dim disabled:opacity-40";

function Arrow({
  dir,
  enabled,
  href,
  onClick,
}: {
  dir: "left" | "right";
  enabled: boolean;
  href?: string | null;
  onClick: () => void;
}) {
  const label = dir === "left" ? "Previous day" : "Next day";
  if (href && enabled) {
    return (
      <MotionLink
        href={href}
        prefetch
        scroll={false}
        aria-label={label}
        onClick={(e: MouseEvent) => {
          e.preventDefault();
          onClick();
        }}
        whileTap={{ scale: 0.88 }}
        transition={spring.press}
        className={btn}
      >
        <Chevron dir={dir} />
      </MotionLink>
    );
  }
  return (
    <motion.button
      type="button"
      aria-label={label}
      disabled={!enabled}
      onClick={onClick}
      whileTap={{ scale: 0.88 }}
      transition={spring.press}
      className={btn}
    >
      <Chevron dir={dir} />
    </motion.button>
  );
}

/** ‹ TODAY › with a mono date underneath; the label slides with the direction of travel. */
export function DateSwitcher({
  title,
  dateLabel,
  canPrev,
  canNext,
  onPrev,
  onNext,
  direction,
  prevHref,
  nextHref,
  onTitleClick,
  pending = false,
}: DateSwitcherProps) {
  const label = (
    <AnimatePresence initial={false} custom={direction}>
      <motion.div
        key={title + dateLabel}
        custom={direction}
        variants={slide}
        initial="enter"
        animate="center"
        exit="exit"
        transition={spring.snappy}
        className="absolute inset-0 flex flex-col items-center"
      >
        <span className="font-display text-[22px] font-bold uppercase leading-none tracking-[0.08em]">{title}</span>
        <span className="telemetry mt-1.5 flex items-center gap-1">
          {dateLabel}
          {onTitleClick && (
            <svg aria-hidden width="8" height="8" viewBox="0 0 8 8" className="opacity-70">
              <path d="M1.5 3 4 5.5 6.5 3" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </span>
      </motion.div>
    </AnimatePresence>
  );

  return (
    <div className="nav-chrome flex items-center justify-center gap-2">
      <Arrow dir="left" enabled={canPrev} href={prevHref} onClick={onPrev} />

      <div
        className="relative h-[42px] w-44 overflow-hidden text-center transition-opacity duration-300"
        style={{ opacity: pending ? 0.6 : 1 }}
        aria-live="polite"
      >
        {onTitleClick ? (
          <button
            type="button"
            onClick={onTitleClick}
            aria-label={`${title}, ${dateLabel}. Choose a date`}
            className="absolute inset-0 active:scale-[0.97] transition-transform"
          >
            {label}
          </button>
        ) : (
          label
        )}
      </div>

      <Arrow dir="right" enabled={canNext} href={nextHref} onClick={onNext} />
    </div>
  );
}
