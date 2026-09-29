"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { alpha } from "@/lib/ui/colors";
import { PRESS_SCALE, spring } from "@/lib/ui/motion";

const MotionLink = motion.create(Link);

const sizes = {
  md: "h-11 px-5 text-[13px] gap-2",
  lg: "h-[52px] px-6 text-[14px] gap-2",
};

/** A <Link> that looks like <Button> (primary / signal / secondary). */
export function LinkButton({
  href,
  children,
  variant = "primary",
  color = "var(--strain)",
  size = "lg",
  icon,
  iconAfter,
  className = "",
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "signal" | "secondary";
  color?: string;
  size?: "md" | "lg";
  icon?: ReactNode;
  /** Trailing icon (e.g. an arrow). */
  iconAfter?: ReactNode;
  className?: string;
}) {
  const variants = {
    primary: "bg-white text-bg shadow-[0_1px_0_rgb(255_255_255/0.4)_inset,0_6px_20px_-8px_rgb(255_255_255/0.35)]",
    signal: "text-bg",
    secondary:
      "bg-white/[0.03] text-text shadow-[inset_0_0_0_1px_var(--hairline-strong),inset_0_1px_0_rgb(255_255_255/0.06)]",
  };
  const style: CSSProperties | undefined =
    variant === "signal"
      ? { background: color, boxShadow: `0 0 0 1px ${alpha(color, 60)} inset, 0 8px 24px -8px ${alpha(color, 70)}` }
      : undefined;
  return (
    <MotionLink
      href={href}
      whileTap={{ scale: PRESS_SCALE }}
      transition={spring.press}
      className={`relative flex w-full select-none items-center justify-center rounded-full font-semibold uppercase tracking-[0.12em] ${sizes[size]} ${variants[variant]} ${className}`}
      style={style}
    >
      {icon}
      <span>{children}</span>
      {iconAfter}
    </MotionLink>
  );
}

export const SyncIcon = ({ size = 18, className = "" }: { size?: number; className?: string }) => (
  <svg aria-hidden width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M20 11a8 8 0 0 0-14-4.5L4 9" />
    <path d="M4 4v5h5" />
    <path d="M4 13a8 8 0 0 0 14 4.5L20 15" />
    <path d="M20 20v-5h-5" />
  </svg>
);

export const ArrowIcon = ({ size = 16 }: { size?: number }) => (
  <svg aria-hidden width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 8h10M9 4l4 4-4 4" />
  </svg>
);

/** Client clock that starts at the server's render time (hydration-safe) and ticks. */
export function useNow(renderedAt: number, everyMs = 15_000): number {
  const [now, setNow] = useState(renderedAt);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = window.setTimeout(tick, 0);
    const id = window.setInterval(tick, everyMs);
    const onVisible = () => document.visibilityState === "visible" && tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [everyMs]);
  return now;
}

const monthDay = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** "Sep 27 – 29", "Sep 30 – Oct 2", "Sep 29" (for `YYYY-MM-DD` dates). */
export function formatDateRange(from: string, to: string): string {
  const a = new Date(`${from}T00:00:00Z`);
  const b = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return "—";
  if (from === to) return monthDay.format(a);
  const sameMonth = a.getUTCMonth() === b.getUTCMonth() && a.getUTCFullYear() === b.getUTCFullYear();
  return `${monthDay.format(a)} – ${sameMonth ? b.getUTCDate() : monthDay.format(b)}`;
}

/** Compact "age" for big numerals: { value: "12", unit: "min ago" }. */
export function compactAge(at: Date, now: number): { value: string; unit: string } {
  const s = Math.max(0, Math.round((now - at.getTime()) / 1000));
  if (s < 60) return { value: "Now", unit: "just synced" };
  const m = Math.floor(s / 60);
  if (m < 60) return { value: String(m), unit: "min ago" };
  const h = Math.floor(m / 60);
  if (h < 24) return { value: String(h), unit: h === 1 ? "hour ago" : "hours ago" };
  const d = Math.floor(h / 24);
  if (d < 100) return { value: String(d), unit: d === 1 ? "day ago" : "days ago" };
  return { value: monthDay.format(at), unit: "last sync" };
}
