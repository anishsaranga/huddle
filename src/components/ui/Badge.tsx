import type { ReactNode } from "react";
import { alpha, SIGNAL } from "@/lib/ui/colors";

export type BadgeTone = "neutral" | "admin" | "success" | "warning" | "danger";

const toneColor: Record<BadgeTone, string> = {
  neutral: "var(--muted)",
  admin: SIGNAL.strain,
  success: SIGNAL.green,
  warning: SIGNAL.yellow,
  danger: SIGNAL.red,
};

type BadgeProps = { children: ReactNode; tone?: BadgeTone; className?: string };

/** Tiny mono ALL-CAPS status chip. Color only where it carries meaning. */
export function Badge({ children, tone = "neutral", className = "" }: BadgeProps) {
  const color = toneColor[tone];
  return (
    <span
      className={`telemetry inline-flex items-center rounded-full px-2 py-[3px] leading-none ${className}`}
      style={{
        color,
        background: alpha(color, 12),
        boxShadow: `inset 0 0 0 1px ${alpha(color, 28)}`,
      }}
    >
      {children}
    </span>
  );
}
