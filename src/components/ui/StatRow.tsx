import type { ReactNode } from "react";
import { deltaColor } from "@/lib/ui/colors";
import { formatNumber } from "@/lib/ui/format";

type StatRowProps = {
  label: string;
  value: number;
  unit?: string;
  /** 30-day baseline in the same unit. */
  baseline?: number;
  decimals?: number;
  /** Whether a value above baseline is good (HRV, sleep) or bad (resting HR). */
  higherIsBetter?: boolean;
  /** Custom value formatter output (e.g. "7:12" for hours). */
  display?: string;
  /** Custom baseline text, same idea as `display`. */
  baselineDisplay?: string;
  icon?: ReactNode;
  className?: string;
};

/**
 * Key-stat row: label + 30-day baseline (mono) on the left, value + unit and a
 * ▲/▼ delta on the right, colored good/bad relative to `higherIsBetter`.
 */
export function StatRow({
  label,
  value,
  unit,
  baseline,
  decimals = 0,
  higherIsBetter = true,
  display,
  baselineDisplay,
  icon,
  className = "",
}: StatRowProps) {
  const hasBaseline = typeof baseline === "number";
  // Deltas smaller than the displayed precision read as "flat".
  const rawDelta = hasBaseline ? value - baseline : 0;
  const step = 10 ** -decimals;
  const delta = Math.abs(rawDelta) < step / 2 ? 0 : rawDelta;
  const color = deltaColor(delta, higherIsBetter);
  const direction = delta > 0 ? "above" : delta < 0 ? "below" : "at";
  const verdict =
    delta === 0 ? "" : (higherIsBetter ? delta > 0 : delta < 0) ? ", better" : ", worse";

  const valueText = display ?? formatNumber(value, decimals);
  const baseText = baselineDisplay ?? (hasBaseline ? formatNumber(baseline, decimals) : "");

  return (
    <div className={`flex min-h-[56px] items-center gap-3 py-2.5 ${className}`}>
      {icon && <span className="shrink-0 text-muted">{icon}</span>}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-medium leading-tight text-text">{label}</p>
        {hasBaseline && (
          <p className="telemetry mt-1">
            30D <span className="text-text-2">{baseText}</span>
            {unit ? ` ${unit}` : ""}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-baseline gap-1.5">
        {hasBaseline && (
          <span
            aria-hidden
            className="relative -top-[2px] w-3 text-center text-[10px] leading-none"
            style={{ color }}
          >
            {delta > 0 ? "▲" : delta < 0 ? "▼" : "–"}
          </span>
        )}
        <span className="num font-display text-[26px] font-semibold leading-none text-text">
          {valueText}
        </span>
        {unit && <span className="telemetry w-9 text-left">{unit}</span>}
      </div>
      {hasBaseline && (
        <span className="sr-only">
          {`${direction} 30-day baseline of ${baseText}${unit ? ` ${unit}` : ""}${verdict}`}
        </span>
      )}
    </div>
  );
}
