"use client";

import { motion, useReducedMotion } from "motion/react";
import { formatDuration } from "@/lib/dashboard/format";
import { ZONE_COLORS } from "@/lib/ui/colors";
import { ease } from "@/lib/ui/motion";

/**
 * Heart-rate zone minutes as one segmented bar (Z1 → Z5, blue shades) with a
 * compact legend. The bar wipes in from the left (scaleX).
 */
export function ZoneBar({ zones, delay = 0 }: { zones: number[]; delay?: number }) {
  const reduced = useReducedMotion();
  const total = zones.reduce((a, b) => a + b, 0);
  const label = zones.map((m, i) => `zone ${i + 1} ${m} minutes`).join(", ");

  return (
    <div role="img" aria-label={`Heart rate zones: ${label}`}>
      <div className="relative h-[7px] overflow-hidden rounded-full bg-white/[0.05]">
        {total > 0 && (
          <motion.div
            className="absolute inset-0 flex origin-left gap-[2px]"
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={reduced ? { duration: 0 } : { duration: 0.9, delay, ease: ease.outExpo }}
          >
            {zones.map((m, i) =>
              m > 0 ? (
                <span key={i} className="h-full first:rounded-l-full last:rounded-r-full" style={{ flex: m, background: ZONE_COLORS[i] }} />
              ) : null,
            )}
          </motion.div>
        )}
      </div>
      <div aria-hidden className="mt-2.5 grid grid-cols-5 gap-1">
        {zones.map((m, i) => (
          <div key={i} className="min-w-0">
            <div className="flex items-center gap-1">
              <span className="size-[6px] shrink-0 rounded-[2px]" style={{ background: ZONE_COLORS[i] }} />
              <span className="telemetry text-[9px]">Z{i + 1}</span>
            </div>
            <p className={`num mt-0.5 font-mono text-[11px] ${m > 0 ? "text-text-2" : "text-dim"}`}>{formatDuration(m)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
