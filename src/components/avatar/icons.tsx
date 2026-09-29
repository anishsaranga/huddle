import type { SVGProps } from "react";

/** Stroke icons for the avatar customizer (16px grid, currentColor). */

const base = {
  width: 18,
  height: 18,
  viewBox: "0 0 18 18",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

type P = SVGProps<SVGSVGElement>;

export function DiceIcon(p: P) {
  return (
    <svg {...base} {...p}>
      <rect x="2.5" y="2.5" width="13" height="13" rx="3.2" />
      <circle cx="6.2" cy="6.2" r="1.05" fill="currentColor" stroke="none" />
      <circle cx="11.8" cy="6.2" r="1.05" fill="currentColor" stroke="none" />
      <circle cx="9" cy="9" r="1.05" fill="currentColor" stroke="none" />
      <circle cx="6.2" cy="11.8" r="1.05" fill="currentColor" stroke="none" />
      <circle cx="11.8" cy="11.8" r="1.05" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function UndoIcon(p: P) {
  return (
    <svg {...base} {...p}>
      <path d="M6.5 4 3 7.5 6.5 11" />
      <path d="M3.5 7.5h7a4.5 4.5 0 0 1 0 9H8" />
    </svg>
  );
}

export function RedoIcon(p: P) {
  return (
    <svg {...base} {...p}>
      <path d="M11.5 4 15 7.5 11.5 11" />
      <path d="M14.5 7.5h-7a4.5 4.5 0 0 0 0 9H10" />
    </svg>
  );
}

export function ResetIcon(p: P) {
  return (
    <svg {...base} {...p}>
      <path d="M3 9a6 6 0 1 0 1.8-4.3" />
      <path d="M3 3v3.2h3.2" />
    </svg>
  );
}

export function ShuffleIcon(p: P) {
  return (
    <svg {...base} {...p}>
      <path d="M2.5 5h2.2c1.6 0 2.6.7 3.5 2.1l1.6 2.8c.9 1.4 1.9 2.1 3.5 2.1h2.2" />
      <path d="M2.5 13h2.2c1.2 0 2-.4 2.7-1.1" />
      <path d="M10.6 6.1c.7-.7 1.5-1.1 2.7-1.1h2.2" />
      <path d="m13.8 3.2 1.9 1.8-1.9 1.8" />
      <path d="m13.8 11.2 1.9 1.8-1.9 1.8" />
    </svg>
  );
}

export function CheckIcon(p: P) {
  return (
    <svg {...base} viewBox="0 0 12 12" strokeWidth={2} {...p}>
      <path d="m2.6 6.3 2.2 2.2 4.6-4.9" />
    </svg>
  );
}

export function NoneIcon(p: P) {
  return (
    <svg {...base} {...p}>
      <circle cx="9" cy="9" r="6" />
      <path d="m4.8 13.2 8.4-8.4" />
    </svg>
  );
}
