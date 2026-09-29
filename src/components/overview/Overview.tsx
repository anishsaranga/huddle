"use client";

import { motion } from "motion/react";
import { useState } from "react";
import { Dial } from "@/components/charts/Dial";
import { HourBars } from "@/components/charts/HourBars";
import { Hypnogram } from "@/components/charts/Hypnogram";
import { AmbientGlow } from "@/components/ui/AmbientGlow";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Stagger, StaggerItem } from "@/components/ui/Stagger";
import { StatRow } from "@/components/ui/StatRow";
import { useToast } from "@/components/ui/Toast";
import type { OverviewDay } from "@/lib/mock/overview";
import { recoveryColor, SIGNAL, STRAIN_MAX } from "@/lib/ui/colors";
import { formatNumber } from "@/lib/ui/format";
import { DIAL_STAGGER } from "@/lib/ui/motion";
import { DateSwitcher } from "./DateSwitcher";

/** Card header: ALL-CAPS title left, mono telemetry right. */
function CardHead({ title, meta }: { title: string; meta?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-baseline justify-between gap-3">
      <h2 className="label text-text-2">{title}</h2>
      {meta && <span className="telemetry">{meta}</span>}
    </div>
  );
}

function SyncIcon() {
  return (
    <svg
      aria-hidden
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 11a8 8 0 0 0-14-4.5L4 9" />
      <path d="M4 4v5h5" />
      <path d="M4 13a8 8 0 0 0 14 4.5L20 15" />
      <path d="M20 20v-5h-5" />
    </svg>
  );
}

/**
 * Overview ("Home"). Entry choreography: glow fades up, dials sweep in
 * sequence (Recovery → Strain → Sleep) while numerals count, then cards
 * stagger up. Switching days re-sweeps dials from their previous values
 * and crossfades the glow to the new recovery color.
 */
export function Overview({ days }: { days: OverviewDay[] }) {
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const { toast } = useToast();
  const day = days[index];
  const glow = recoveryColor(day.recovery);

  const go = (next: number) => {
    setDirection(next > index ? -1 : 1);
    setIndex(next);
  };

  const sync = () => {
    setSyncing(true);
    window.setTimeout(() => {
      setSyncing(false);
      toast({ title: "Synced", description: "3 days of data imported.", tone: "success" });
    }, 1400);
  };

  return (
    <div className="relative isolate min-h-full">
      <AmbientGlow color={glow} />

      <header className="pt-safe px-safe">
        <motion.div
          className="px-3 pb-2 pt-3"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4 }}
        >
          <DateSwitcher
            title={day.title}
            dateLabel={day.dateLabel}
            canPrev={index < days.length - 1}
            canNext={index > 0}
            onPrev={() => go(index + 1)}
            onNext={() => go(index - 1)}
            direction={direction}
          />
        </motion.div>
      </header>

      <section aria-label="Today's scores" className="grid grid-cols-3 px-3 pb-7 pt-5">
        <Dial
          value={day.recovery}
          max={100}
          format="percent"
          color={glow}
          label="Recovery"
          delay={0.12}
        />
        <Dial
          value={day.strain}
          max={STRAIN_MAX}
          format="decimal"
          color={SIGNAL.strain}
          label="Strain"
          delay={0.12 + DIAL_STAGGER}
        />
        <Dial
          value={day.sleep}
          max={100}
          format="percent"
          color={SIGNAL.sleep}
          label="Sleep"
          delay={0.12 + DIAL_STAGGER * 2}
        />
      </section>

      <Stagger delay={0.5} className="space-y-3 px-4">
        <StaggerItem>
          <Card padding="px-5 pb-2 pt-5">
            <CardHead title="Key stats" meta="vs 30-day avg" />
            <div className="divide-y divide-hairline">
              {day.stats.map((s) => (
                <StatRow
                  key={s.id}
                  label={s.label}
                  value={s.value}
                  unit={s.unit}
                  baseline={s.baseline}
                  decimals={s.decimals}
                  higherIsBetter={s.higherIsBetter}
                  display={s.display}
                  baselineDisplay={s.baselineDisplay}
                />
              ))}
            </div>
          </Card>
        </StaggerItem>

        <StaggerItem>
          <Card glow={SIGNAL.strain}>
            <CardHead
              title={index === 0 ? "Today's strain" : "Day strain"}
              meta={
                <>
                  AVG <span className="text-text-2">{day.avgHr}</span> · MAX{" "}
                  <span className="text-text-2">{day.maxHr}</span> BPM
                </>
              }
            />
            <div className="mb-4 flex items-baseline gap-2">
              <span className="num font-display text-[34px] font-semibold leading-none">
                {formatNumber(day.strain, 1)}
              </span>
              <span className="telemetry">/ {STRAIN_MAX}</span>
            </div>
            <HourBars
              key={day.id}
              data={day.hourly}
              ariaLabel={`Heart rate by hour. Average ${day.avgHr}, max ${day.maxHr} beats per minute.`}
              delay={0.15}
            />
          </Card>
        </StaggerItem>

        <StaggerItem>
          <Card glow={SIGNAL.sleep}>
            <CardHead
              title="Last night"
              meta={
                <>
                  {day.bedtime} → {day.wake}
                </>
              }
            />
            <div className="mb-4 flex gap-6">
              <div>
                <p className="telemetry">Asleep</p>
                <p className="num mt-1 font-display text-[28px] font-semibold leading-none">
                  {day.asleep}
                </p>
              </div>
              <div>
                <p className="telemetry">In bed</p>
                <p className="num mt-1 font-display text-[28px] font-semibold leading-none text-text-2">
                  {day.inBed}
                </p>
              </div>
            </div>
            <Hypnogram
              key={day.id}
              compact
              segments={day.sleepSegments}
              startLabel={day.bedtime}
              endLabel={day.wake}
              ariaLabel={`Sleep stages from ${day.bedtime} to ${day.wake}. ${day.asleep} asleep.`}
              delay={0.2}
            />
          </Card>
        </StaggerItem>

        <StaggerItem className="flex items-center justify-between gap-3 px-1 pb-2 pt-3">
          <span className="telemetry flex items-center gap-2">
            <span
              aria-hidden
              className="size-1.5 rounded-full"
              style={{ background: SIGNAL.green, boxShadow: `0 0 6px ${SIGNAL.green}` }}
            />
            {day.syncedLabel}
          </span>
          <Button
            variant="secondary"
            size="sm"
            loading={syncing}
            icon={<SyncIcon />}
            onClick={sync}
          >
            {syncing ? "Syncing" : "Sync"}
          </Button>
        </StaggerItem>
      </Stagger>
    </div>
  );
}
