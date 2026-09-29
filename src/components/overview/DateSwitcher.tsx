"use client";

import { AnimatePresence, motion, type Variants } from "motion/react";
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

/** ‹ TODAY › with a mono date underneath; the label slides with the direction of travel. */
export function DateSwitcher({
  title,
  dateLabel,
  canPrev,
  canNext,
  onPrev,
  onNext,
  direction,
}: DateSwitcherProps) {
  const btn =
    "grid size-11 place-items-center rounded-full text-text-2 disabled:text-dim disabled:opacity-40";

  return (
    <div className="nav-chrome flex items-center justify-center gap-2">
      <motion.button
        type="button"
        aria-label="Previous day"
        disabled={!canPrev}
        onClick={onPrev}
        whileTap={{ scale: 0.88 }}
        transition={spring.press}
        className={btn}
      >
        <Chevron dir="left" />
      </motion.button>

      <div className="relative h-[42px] w-40 overflow-hidden text-center" aria-live="polite">
        <AnimatePresence initial={false} custom={direction}>
          <motion.div
            key={title}
            custom={direction}
            variants={slide}
            initial="enter"
            animate="center"
            exit="exit"
            transition={spring.snappy}
            className="absolute inset-0 flex flex-col items-center"
          >
            <span className="font-display text-[22px] font-bold uppercase leading-none tracking-[0.08em]">
              {title}
            </span>
            <span className="telemetry mt-1.5">{dateLabel}</span>
          </motion.div>
        </AnimatePresence>
      </div>

      <motion.button
        type="button"
        aria-label="Next day"
        disabled={!canNext}
        onClick={onNext}
        whileTap={{ scale: 0.88 }}
        transition={spring.press}
        className={btn}
      >
        <Chevron dir="right" />
      </motion.button>
    </div>
  );
}
