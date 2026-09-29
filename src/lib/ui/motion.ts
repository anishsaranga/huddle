import type { Transition } from "motion/react";

/**
 * Motion tokens. Only transform / opacity / stroke (pathLength) are ever
 * animated — never filter or backdrop-filter (janky on iOS Safari).
 */

type Bezier = [number, number, number, number];

export const ease = {
  /** Default UI ease-out. */
  out: [0.22, 1, 0.36, 1] as Bezier,
  /** Long, decelerating tail — count-ups and chart draws. */
  outExpo: [0.16, 1, 0.3, 1] as Bezier,
  inOut: [0.65, 0, 0.35, 1] as Bezier,
};

export const spring = {
  /** Press feedback: fast, no wobble. */
  press: { type: "spring", stiffness: 700, damping: 38, mass: 0.6 },
  /** Sliding indicators (tabs, segmented controls). */
  snappy: { type: "spring", stiffness: 480, damping: 38 },
  /** Card / list entrances. */
  soft: { type: "spring", visualDuration: 0.5, bounce: 0.12 },
  /** Dial arc sweep. */
  dial: { type: "spring", visualDuration: 1.15, bounce: 0.1 },
  /** Icon tap bounce (slight overshoot on release). */
  bouncy: { type: "spring", stiffness: 520, damping: 14 },
  /** Sheets & toasts. */
  sheet: { type: "spring", stiffness: 380, damping: 36 },
} satisfies Record<string, Transition>;

export const PRESS_SCALE = 0.97;

/** Delay between items in a staggered entrance, seconds. */
export const STAGGER = 0.055;

/** Delay between the three overview dials, seconds. */
export const DIAL_STAGGER = 0.12;
