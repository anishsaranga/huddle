"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { addMonths, monthGrid, monthTitle } from "@/lib/dashboard/dates";
import { recoveryColor } from "@/lib/ui/colors";
import { spring } from "@/lib/ui/motion";

type DateSheetProps = {
  open: boolean;
  onClose: () => void;
  selected: string;
  today: string;
  firstDate: string | null;
  /** Recovery % by date (for the colored dots), as [date, value] pairs. */
  recovery: [string, number | null][];
  onPick: (date: string) => void;
};

const WEEK = ["M", "T", "W", "T", "F", "S", "S"];

/**
 * Month calendar in a bottom sheet. Each day carries a dot in its recovery
 * band color, so a month reads as a heatmap at a glance; days outside the
 * data range are dimmed and disabled.
 */
export function DateSheet({ open, onClose, selected, today, firstDate, recovery, onPick }: DateSheetProps) {
  return (
    <Sheet open={open} onClose={onClose} title="Pick a day">
      {/* Remount per open so the month resets to the selected date. */}
      {open && (
        <Calendar selected={selected} today={today} firstDate={firstDate} recovery={recovery} onPick={onPick} />
      )}
    </Sheet>
  );
}

function Calendar({ selected, today, firstDate, recovery, onPick }: Omit<DateSheetProps, "open" | "onClose">) {
  const [month, setMonth] = useState(selected.slice(0, 7));
  const [dir, setDir] = useState(0);
  const byDate = new Map(recovery);
  const lo = firstDate && firstDate < today ? firstDate : today;
  const canPrev = month > lo.slice(0, 7);
  const canNext = month < today.slice(0, 7);
  const shift = (n: number) => {
    setDir(n);
    setMonth((m) => addMonths(m, n));
  };

  const arrow = (n: number, enabled: boolean) => (
    <motion.button
      type="button"
      aria-label={n < 0 ? "Previous month" : "Next month"}
      disabled={!enabled}
      onClick={() => shift(n)}
      whileTap={{ scale: 0.88 }}
      transition={spring.press}
      className="grid size-10 place-items-center rounded-full text-text-2 disabled:opacity-30"
    >
      <svg aria-hidden width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d={n < 0 ? "M11 4 6 9l5 5" : "m7 4 5 5-5 5"} />
      </svg>
    </motion.button>
  );

  return (
    <div className="pb-2">
      <div className="mb-3 flex items-center justify-between">
        {arrow(-1, canPrev)}
        <p className="telemetry text-text-2" aria-live="polite">
          {monthTitle(month)}
        </p>
        {arrow(1, canNext)}
      </div>
      <div aria-hidden className="mb-1 grid grid-cols-7">
        {WEEK.map((d, i) => (
          <span key={i} className="telemetry text-center text-[9.5px] text-dim">
            {d}
          </span>
        ))}
      </div>
      <div className="relative overflow-hidden">
        <AnimatePresence initial={false} mode="popLayout" custom={dir}>
          <motion.div
            key={month}
            custom={dir}
            initial={{ opacity: 0, x: dir * 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: dir * -40 }}
            transition={spring.snappy}
            role="grid"
            aria-label={monthTitle(month)}
          >
            {monthGrid(month).map((week, wi) => (
              <div key={wi} role="row" className="grid grid-cols-7">
                {week.map((d, di) => {
                  if (!d) return <span key={di} role="gridcell" />;
                  const inRange = d >= lo && d <= today;
                  const isSel = d === selected;
                  const rec = byDate.get(d);
                  const dayNum = Number(d.slice(8));
                  return (
                    <span key={di} role="gridcell" className="flex justify-center py-[3px]">
                      <motion.button
                        type="button"
                        disabled={!inRange}
                        aria-current={isSel ? "date" : undefined}
                        aria-label={`${d}${typeof rec === "number" ? `, recovery ${rec}%` : ""}`}
                        onClick={() => onPick(d)}
                        whileTap={{ scale: 0.9 }}
                        transition={spring.press}
                        className={`relative flex size-11 flex-col items-center justify-center rounded-full disabled:opacity-25 ${
                          isSel ? "bg-white text-bg" : d === today ? "text-text shadow-[inset_0_0_0_1px_var(--hairline-strong)]" : "text-text-2"
                        }`}
                      >
                        <span className="num font-display text-[17px] font-semibold leading-none">{dayNum}</span>
                        <span
                          aria-hidden
                          className="mt-[5px] size-[5px] rounded-full"
                          style={{
                            background: typeof rec === "number" ? recoveryColor(rec) : "transparent",
                            boxShadow: typeof rec === "number" && !isSel ? `0 0 6px ${recoveryColor(rec)}` : undefined,
                          }}
                        />
                      </motion.button>
                    </span>
                  );
                })}
              </div>
            ))}
          </motion.div>
        </AnimatePresence>
      </div>
      <p className="telemetry mt-3 flex items-center justify-center gap-3 text-[9.5px]">
        {(["green", "yellow", "red"] as const).map((b) => (
          <span key={b} className="flex items-center gap-1.5">
            <span className="size-[5px] rounded-full" style={{ background: `var(--recovery-${b})` }} />
            {b === "green" ? "67+" : b === "yellow" ? "34–66" : "≤33"}
          </span>
        ))}
        <span className="text-dim">RECOVERY</span>
      </p>
    </div>
  );
}
