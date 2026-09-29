"use client";

import { AnimatePresence, motion } from "motion/react";
import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { TrendBars } from "@/components/charts/TrendBars";
import { CardHead } from "@/components/dashboard/bits";
import { Card } from "@/components/ui/Card";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { formatHm } from "@/lib/dashboard/format";
import type { TrendSeries } from "@/lib/dashboard/trend";
import type { TrendRange } from "@/lib/scores/queries";
import { formatNumber } from "@/lib/ui/format";

export type TrendFormat = "percent" | "decimal" | "hm" | "int";

export type TrendMetric = {
  key: string;
  label: string;
  series: TrendSeries;
  /** 30-day average (dashed line + default readout). */
  avg: number | null;
  format: TrendFormat;
  /** Scale maximum (e.g. 100 for %, 21 for strain). */
  max?: number;
  color: string;
};

const RANGES: { value: TrendRange; label: string }[] = [
  { value: "1w", label: "1W" },
  { value: "1m", label: "1M" },
  { value: "6m", label: "6M" },
];

function fmt(v: number, f: TrendFormat): { value: string; unit: string } {
  switch (f) {
    case "percent":
      return { value: formatNumber(Math.round(v), 0), unit: "%" };
    case "decimal":
      return { value: formatNumber(v, 1), unit: "" };
    case "hm":
      return { value: formatHm(v), unit: "HRS" };
    case "int":
      return { value: formatNumber(Math.round(v), 0), unit: "" };
  }
}

/**
 * Trend card: 1W / 1M / 6M bars with a dashed 30-day average. Touch the chart
 * (or drag across it) to read a bar; arrow keys do the same. No hover.
 */
export function TrendCard({ metrics: all, title = "Trend" }: { metrics: TrendMetric[]; title?: string }) {
  // Metrics with no value in six months (e.g. sleep score on a phone-only setup) have nothing to chart.
  const metrics = all.filter((m) => m.series["6m"].some((b) => b.value !== null));
  if (metrics.length === 0) return null;
  return <TrendCardInner metrics={metrics} title={title} />;
}

function TrendCardInner({ metrics, title }: { metrics: TrendMetric[]; title: string }) {
  const [range, setRange] = useState<TrendRange>("1m");
  const [metricKey, setMetricKey] = useState(metrics[0].key);
  const [active, setActive] = useState<number | null>(null);
  const dragging = useRef(false);
  const metric = metrics.find((m) => m.key === metricKey) ?? metrics[0];
  const bars = metric.series[range];
  const sel = active !== null ? bars[active] : null;
  const gap = range === "1m" ? 2 : range === "6m" ? 3 : 6;

  const indexAt = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.floor(((e.clientX - r.left) / r.width) * bars.length);
    return Math.min(bars.length - 1, Math.max(0, i));
  };

  const readoutLabel = sel ? sel.title : range === "6m" ? "30-DAY AVG · WEEKLY BARS" : "30-DAY AVG";
  const readoutValue = sel ? sel.value : metric.avg;
  const shown = readoutValue !== null ? fmt(readoutValue, metric.format) : null;
  const valueText = shown ? `${shown.value}${shown.unit === "%" ? "%" : shown.unit ? ` ${shown.unit.toLowerCase()}` : ""}` : "no data";

  return (
    <Card>
      <CardHead
        title={title}
        meta={
          metrics.length > 1 ? (
            <SegmentedControl
              size="sm"
              ariaLabel="Metric"
              options={metrics.map((m) => ({ value: m.key, label: m.label }))}
              value={metric.key}
              onChange={(k) => {
                setMetricKey(k);
                setActive(null);
              }}
            />
          ) : undefined
        }
      />

      <div className="mb-4 h-[52px]" aria-live="polite">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={`${metric.key}-${range}-${active ?? "avg"}`}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.16 }}
          >
            <p className="telemetry">{readoutLabel}</p>
            <p className="mt-1.5 flex items-baseline gap-1.5">
              <span className="num font-display text-[34px] font-semibold leading-[0.9]" style={{ color: sel?.color ?? undefined }}>
                {shown ? shown.value : "—"}
              </span>
              {shown?.unit && <span className="telemetry">{shown.unit}</span>}
            </p>
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="relative">
        <TrendBars
          key={`${metric.key}-${range}`}
          data={bars.map((b) => ({ label: b.label, value: b.value, color: b.color }))}
          max={metric.max}
          color={metric.color}
          baseline={metric.avg ?? undefined}
          height={140}
          gap={gap}
          activeIndex={active}
          ariaLabel={`${metric.label}, ${RANGES.find((r) => r.value === range)!.label} trend. 30-day average ${
            metric.avg !== null ? `${fmt(metric.avg, metric.format).value}${fmt(metric.avg, metric.format).unit}` : "unavailable"
          }.`}
        />
        {/* Touch / keyboard scrubber over the plot area. */}
        <div
          role="slider"
          tabIndex={0}
          aria-label={`Read ${metric.label.toLowerCase()} by ${range === "6m" ? "week" : "day"}`}
          aria-valuemin={0}
          aria-valuemax={bars.length - 1}
          aria-valuenow={active ?? bars.length - 1}
          aria-valuetext={sel ? `${sel.title}: ${valueText}` : `30-day average: ${valueText}`}
          className="absolute inset-x-0 top-0 h-[140px] touch-pan-y rounded-md outline-offset-4"
          onPointerDown={(e) => {
            dragging.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            const i = indexAt(e);
            setActive((cur) => (cur === i && e.pointerType !== "mouse" ? null : i));
          }}
          onPointerMove={(e) => {
            if (dragging.current) setActive(indexAt(e));
          }}
          onPointerUp={() => {
            dragging.current = false;
          }}
          onPointerCancel={() => {
            dragging.current = false;
          }}
          onKeyDown={(e: KeyboardEvent) => {
            if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
              e.preventDefault();
              const d = e.key === "ArrowLeft" ? -1 : 1;
              setActive((cur) => Math.min(bars.length - 1, Math.max(0, (cur ?? bars.length) + d)));
            } else if (e.key === "Escape") {
              setActive(null);
            }
          }}
        />
      </div>

      <div className="mt-5">
        <SegmentedControl
          ariaLabel="Range"
          options={RANGES}
          value={range}
          onChange={(r) => {
            setRange(r);
            setActive(null);
          }}
        />
      </div>
    </Card>
  );
}
