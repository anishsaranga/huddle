"use client";

import { motion } from "motion/react";
import { useId } from "react";
import { adviceFor, blockCount, DEVICES, RECIPE_EXTRAS, RECIPE_METRICS, type Advice, type DeviceId, type RecipeMetric } from "@/lib/sync/recipe";
import { alpha, SIGNAL } from "@/lib/ui/colors";
import { spring } from "@/lib/ui/motion";

const ADVICE: Record<Advice, { label: string; color: string }> = {
  include: { label: "Include", color: SIGNAL.green },
  optional: { label: "Optional", color: SIGNAL.yellow },
  skip: { label: "Skip", color: "var(--dim)" },
};

export function AdviceBadge({ advice }: { advice: Advice }) {
  const { label, color } = ADVICE[advice];
  return (
    <span
      className="telemetry inline-flex shrink-0 items-center rounded-full px-1.5 py-[2px] text-[9px] leading-none"
      style={{ color, background: alpha(color, 10), boxShadow: `inset 0 0 0 1px ${alpha(color, 28)}` }}
    >
      {label}
    </span>
  );
}

/** "What do you wear?" chips. */
export function DevicePicker({ value, onChange }: { value: DeviceId; onChange: (d: DeviceId) => void }) {
  const layoutId = `device-${useId()}`;
  const { keep, total } = blockCount(value);
  return (
    <div>
      <div role="radiogroup" aria-label="Your device" className="nav-chrome flex flex-wrap gap-1.5">
        {DEVICES.map((d) => {
          const active = d.id === value;
          return (
            <motion.button
              key={d.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(d.id)}
              whileTap={{ scale: 0.95 }}
              transition={spring.press}
              className={`relative h-9 rounded-full px-3.5 text-[12px] font-semibold uppercase tracking-[0.1em] transition-colors ${
                active ? "text-bg" : "text-text-2 shadow-[inset_0_0_0_1px_var(--hairline-strong)]"
              }`}
            >
              {active && (
                <motion.span
                  layoutId={layoutId}
                  aria-hidden
                  className="absolute inset-0 rounded-full bg-white shadow-[0_1px_10px_rgb(255_255_255/0.2)]"
                  transition={spring.snappy}
                />
              )}
              <span className="relative">{d.label}</span>
            </motion.button>
          );
        })}
      </div>
      <p className="telemetry mt-3" data-testid="device-summary">
        {value === "other"
          ? `Keep all ${total} blocks: empty ones cost a second`
          : `${keep} of ${total} Health blocks for ${DEVICES.find((d) => d.id === value)!.label}`}
      </p>
    </div>
  );
}

/** Metric table for one kind (cumulative / discrete), annotated for the picked device. */
export function MetricTable({ kind, device }: { kind: RecipeMetric["kind"]; device: DeviceId }) {
  const rows = RECIPE_METRICS.filter((m) => m.kind === kind);
  return (
    <ul className="divide-y divide-hairline overflow-hidden rounded-xl bg-card-sunken/70 shadow-[inset_0_0_0_1px_var(--hairline)]">
      {rows.map((m) => {
        const advice = adviceFor(m.devices, device);
        return (
          <li key={m.key} data-metric={m.key} data-advice={advice} className="flex items-center gap-3 px-3 py-2.5">
            <span className={`min-w-0 flex-1 ${advice === "skip" ? "opacity-45" : ""}`}>
              <span className="block text-[14px] font-medium leading-tight text-text">{m.health}</span>
              <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[11px] text-muted">
                <span>{m.unit}</span>
                <span className="text-dim">→</span>
                <span className="text-text-2">{m.key}</span>
                {m.note && <span className="font-sans text-[11.5px] text-dim">· {m.note}</span>}
              </span>
            </span>
            <AdviceBadge advice={advice} />
          </li>
        );
      })}
    </ul>
  );
}

/** Advice for the heart-rate / sleep blocks. */
export function extraAdvice(key: "hr" | "sleep", device: DeviceId): Advice {
  return adviceFor(RECIPE_EXTRAS.find((e) => e.key === key)!.devices, device);
}
