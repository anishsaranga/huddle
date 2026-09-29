import type { ReactNode } from "react";
import { alpha } from "@/lib/ui/colors";

/** Card header: ALL-CAPS title left, mono telemetry (or a control) right. */
export function CardHead({ title, meta, className = "" }: { title: string; meta?: ReactNode; className?: string }) {
  return (
    <div className={`mb-4 flex min-h-5 items-center justify-between gap-3 ${className}`}>
      <h2 className="label text-text-2">{title}</h2>
      {meta && <div className="telemetry flex shrink-0 items-center gap-1.5">{meta}</div>}
    </div>
  );
}

/** Pulsing dot + "LIVE" (today's strain is still accumulating). */
export function LiveBadge({ label = "LIVE", color = "var(--strain)" }: { label?: string; color?: string }) {
  return (
    <span className="telemetry inline-flex items-center gap-1.5 text-[9.5px]" style={{ color }}>
      <span aria-hidden className="relative inline-block size-[6px]">
        <span className="animate-dot-pulse absolute inset-0 rounded-full" style={{ background: color }} />
        <span className="absolute inset-0 rounded-full" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
      </span>
      {label}
    </span>
  );
}

/** Tiny hairline chip, e.g. LIMITED. */
export function Chip({ children, color = "var(--text-2)" }: { children: ReactNode; color?: string }) {
  return (
    <span
      className="telemetry inline-flex items-center rounded-full px-1.5 py-[2px] text-[8.5px] leading-none tracking-[0.12em]"
      style={{ color, background: alpha(color, 10), boxShadow: `inset 0 0 0 1px ${alpha(color, 26)}` }}
    >
      {children}
    </span>
  );
}

/** Small labelled figure: mono caption over a condensed numeral. */
export function Figure({
  label,
  value,
  unit,
  muted = false,
  size = 28,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  muted?: boolean;
  size?: number;
}) {
  return (
    <div className="min-w-0">
      <p className="telemetry truncate">{label}</p>
      <p
        className={`num mt-1.5 whitespace-nowrap font-display font-semibold leading-none ${muted ? "text-text-2" : "text-text"}`}
        style={{ fontSize: size }}
      >
        {value}
        {unit && <span className="telemetry ml-1 align-baseline text-[10px]">{unit}</span>}
      </p>
    </div>
  );
}

/** Inline glyph used for notices (info "i" in a ring). */
export function InfoGlyph({ className = "" }: { className?: string }) {
  return (
    <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" fill="none" className={className}>
      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8 7.2v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="8" cy="4.9" r="0.9" fill="currentColor" />
    </svg>
  );
}

/** A quiet explanatory note (icon + text), for "limited data" and missing-data states. */
export function Notice({ children, color = "var(--muted)", title }: { children: ReactNode; color?: string; title?: string }) {
  return (
    <div
      className="flex gap-3 rounded-[14px] px-4 py-3.5"
      style={{ background: alpha(color, 7), boxShadow: `inset 0 0 0 1px ${alpha(color, 18)}` }}
    >
      <span className="mt-[1px] shrink-0" style={{ color }}>
        <InfoGlyph />
      </span>
      <div className="min-w-0 text-[14px] leading-snug text-text-2">
        {title && <p className="label mb-1" style={{ color }}>{title}</p>}
        {children}
      </div>
    </div>
  );
}
