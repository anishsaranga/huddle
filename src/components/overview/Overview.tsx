"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion, type Variants } from "motion/react";
import { useRef, useState, useTransition, type ReactNode } from "react";
import { Dial } from "@/components/charts/Dial";
import { HourBars } from "@/components/charts/HourBars";
import { Hypnogram } from "@/components/charts/Hypnogram";
import { SleepTimeline } from "@/components/charts/SleepTimeline";
import { CardHead, Chip, Figure, LiveBadge, Notice } from "@/components/dashboard/bits";
import { SyncFooter } from "@/components/dashboard/SyncFooter";
import { ZoneBar } from "@/components/dashboard/ZoneBar";
import { AmbientGlow } from "@/components/ui/AmbientGlow";
import { Card } from "@/components/ui/Card";
import { Stagger, StaggerItem } from "@/components/ui/Stagger";
import { StatRow } from "@/components/ui/StatRow";
import { dateHref } from "@/lib/dashboard/dates";
import { formatInt } from "@/lib/dashboard/format";
import type { DialView, OverviewView, SleepCardView, StrainCardView } from "@/lib/dashboard/overview-view";
import { SIGNAL, STRAIN_MAX } from "@/lib/ui/colors";
import { formatNumber } from "@/lib/ui/format";
import { DIAL_STAGGER, spring } from "@/lib/ui/motion";
import { DateSheet } from "./DateSheet";
import { DateSwitcher } from "./DateSwitcher";

const MotionLink = motion.create(Link);

// The dial row pages like a carousel: older days come in from the left.
const rowSlide: Variants = {
  enter: (dir: number) => ({ opacity: 0, x: dir * 64 }),
  center: { opacity: 1, x: 0 },
  exit: (dir: number) => ({ opacity: 0, x: dir * -64 }),
};

const SWIPE_DISTANCE = 56;
const SWIPE_VELOCITY = 420;

function Chevron() {
  return (
    <svg aria-hidden width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-dim">
      <path d="m6 3.5 4.5 4.5L6 12.5" />
    </svg>
  );
}

type DialSpec = {
  d: DialView;
  label: string;
  max: number;
  format: "percent" | "decimal";
  href: string;
  delay: number;
};

/** One score dial: tappable (→ detail), hollow with a reason when null, LIMITED / LIVE footers. */
function ScoreDial({ d, label, max, format, href, delay }: DialSpec) {
  const hollow = d.value === null;
  const valueText = hollow ? "no score" : `${formatNumber(d.value!, format === "decimal" ? 1 : 0)}${format === "percent" ? "%" : ""}`;
  const extra = hollow ? `, ${d.reason?.toLowerCase() ?? "no data"}` : d.limited ? ", limited data" : d.live ? ", live, so far today" : "";

  let footer: ReactNode = null;
  if (hollow && d.reason) {
    footer = <span className="telemetry block max-w-[112px] text-balance text-center text-[9px] leading-[1.35] text-dim">{d.reason}</span>;
  } else if (d.limited) {
    footer = <Chip>LIMITED</Chip>;
  } else if (d.live) {
    footer = <LiveBadge label="LIVE · SO FAR" />;
  }

  return (
    <MotionLink
      href={href}
      aria-label={`${label}: ${valueText}${extra}. Open ${label.toLowerCase()} details`}
      whileTap={{ scale: 0.95 }}
      transition={spring.press}
      className="flex justify-center rounded-3xl outline-offset-4"
      draggable={false}
    >
      <Dial
        value={d.value ?? 0}
        max={max}
        color={d.color}
        label={label}
        format={format}
        display={hollow ? "—" : undefined}
        hollow={hollow}
        delay={delay}
        ariaLabel={`${label}: ${valueText}${extra}`}
        footer={<div className="-mt-1 flex min-h-[26px] items-start justify-center">{footer}</div>}
      />
    </MotionLink>
  );
}

function StrainCard({ s, isToday, h12, date, href }: { s: StrainCardView; isToday: boolean; h12: boolean; date: string; href: string }) {
  const hasHr = s.hours.some((h) => h !== null);
  return (
    <Card variant="interactive" href={href} glow={SIGNAL.strain}>
      <CardHead
        title={isToday ? "Today's strain" : "Day strain"}
        meta={
          <>
            {s.avgHr !== null && (
              <span>
                AVG <span className="text-text-2">{s.avgHr}</span> · MAX <span className="text-text-2">{s.maxHr}</span> BPM
              </span>
            )}
            <Chevron />
          </>
        }
      />
      <div className="mb-5 flex items-end justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className="num font-display text-[40px] font-semibold leading-[0.8]">
            {s.strain !== null ? formatNumber(s.strain, 1) : "—"}
          </span>
          <span className="telemetry">/ {STRAIN_MAX}</span>
        </div>
        {isToday && s.strain !== null && <LiveBadge label="LIVE" />}
      </div>

      {hasHr ? (
        <HourBars
          key={date}
          data={s.hours}
          nowHour={s.nowHour}
          h12={h12}
          ariaLabel={`Heart rate by hour${s.avgHr !== null ? `. Average ${s.avgHr}, max ${s.maxHr} beats per minute` : ""}.`}
          delay={0.15}
        />
      ) : (
        <p className="text-[14px] leading-snug text-muted">
          No heart-rate data for this day. Strain is estimated from steps and active calories.
        </p>
      )}

      {s.zones && s.zones.some((z) => z > 0) && (
        <div className="mt-5">
          <p className="telemetry mb-2">Heart-rate zones</p>
          <ZoneBar key={date} zones={s.zones} delay={0.3} />
        </div>
      )}

      <div className="mt-5 grid grid-cols-3 gap-3 border-t border-hairline pt-4">
        <Figure label="Active cal" value={s.activeKcal !== null ? formatInt(s.activeKcal) : "—"} size={22} />
        {s.exerciseMin === null && s.maxHr !== null ? (
          // Trackers that don't report exercise minutes (Zepp, Fitbit) still have a peak heart rate.
          <Figure label="Peak HR" value={s.maxHr} unit="bpm" size={22} />
        ) : (
          <Figure label="Exercise" value={s.exerciseMin ?? "—"} unit={s.exerciseMin !== null ? "min" : undefined} size={22} />
        )}
        <Figure label={isToday ? "Steps so far" : "Steps"} value={s.steps !== null ? formatInt(s.steps) : "—"} size={22} />
      </div>
    </Card>
  );
}

function SleepCard({ s, date, href }: { s: SleepCardView; date: string; href: string }) {
  const via = (source: string) => (
    <p className="telemetry mt-4 text-right text-[9.5px] text-dim">
      via <span className="text-muted">{source}</span>
    </p>
  );
  const head = (meta?: ReactNode) => (
    <CardHead
      title="Last night"
      meta={
        <>
          {meta}
          <Chevron />
        </>
      }
    />
  );

  let body: ReactNode;
  switch (s.kind) {
    case "stages":
      body = (
        <>
          {head(<span className="text-text-2">{s.bed} → {s.wake}</span>)}
          <div className="mb-5 grid grid-cols-3 gap-3">
            <Figure label="Asleep" value={s.asleep} />
            <Figure label="In bed" value={s.inBed ?? "—"} muted />
            <Figure label="Efficiency" value={s.efficiency !== null ? `${Math.round(s.efficiency * 100)}%` : "—"} muted />
          </div>
          <Hypnogram
            key={date}
            compact
            segments={s.segments}
            startLabel={s.bed}
            endLabel={s.wake}
            ariaLabel={`Sleep stages from ${s.bed} to ${s.wake}. ${s.asleep} asleep.`}
            delay={0.2}
          />
          {via(s.source)}
        </>
      );
      break;
    case "timeline":
      body = (
        <>
          {head(<span className="text-text-2">{s.bed} → {s.wake}</span>)}
          <div className="mb-5">
            <Figure label="Asleep" value={s.asleep} />
          </div>
          <SleepTimeline
            key={date}
            blocks={s.blocks}
            startLabel={s.bed}
            endLabel={s.wake}
            ariaLabel={`Asleep and awake periods from ${s.bed} to ${s.wake}. ${s.asleep} asleep.`}
            delay={0.2}
          />
          <p className="mt-4 text-[13px] leading-snug text-muted">Stages not available from {s.device}.</p>
          {via(s.source)}
        </>
      );
      break;
    case "in_bed":
      body = (
        <>
          {head(<span className="text-text-2">{s.bed} → {s.wake}</span>)}
          <div className="mb-4">
            <Figure label="In bed" value={s.inBed} muted />
          </div>
          <Notice color={SIGNAL.sleep}>
            Only time in bed was recorded by {s.device === "iPhone" ? "your iPhone" : s.device}. Wear a tracker to bed for
            sleep scores.
          </Notice>
          {via(s.source)}
        </>
      );
      break;
    case "none":
      body = (
        <>
          {head()}
          <p className="text-[14px] leading-snug text-muted">{s.message}</p>
        </>
      );
  }

  return (
    <Card variant="interactive" href={href} glow={SIGNAL.sleep}>
      {body}
    </Card>
  );
}

/**
 * Overview ("Home"). Entry choreography: glow fades up, dials sweep in
 * sequence (Recovery → Strain → Sleep) while numerals count, then cards
 * stagger up. Changing day (chevrons, swipe on the dials, or the calendar)
 * is a URL navigation; the dial row pages out in the direction of travel and
 * the new day's dials sweep in from zero.
 */
export function Overview({
  view,
  firstDate,
  calendar,
}: {
  view: OverviewView;
  firstDate: string | null;
  calendar: [string, number | null][];
}) {
  const router = useRouter();
  const reduced = useReducedMotion();
  const [pending, startTransition] = useTransition();
  const [direction, setDirection] = useState(0);
  const [sheet, setSheet] = useState(false);
  // The first day shown mounts in place (its dials sweep in); later days page in.
  const [initialDate] = useState(view.date);
  const dragged = useRef(false);

  const href = (path: string, d = view.date) => dateHref(path, d, view.today);

  const go = (date: string | null) => {
    if (!date || date === view.date) return;
    setDirection(date < view.date ? -1 : 1);
    startTransition(() => router.push(href("/home", date), { scroll: false }));
  };

  return (
    <div className="relative isolate min-h-full">
      <AmbientGlow color={view.glow} />

      <header className="pt-safe px-safe">
        <motion.div className="px-3 pb-2 pt-3" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>
          <DateSwitcher
            title={view.title}
            dateLabel={view.dateLabel}
            canPrev={view.prev !== null}
            canNext={view.next !== null}
            prevHref={view.prev ? href("/home", view.prev) : null}
            nextHref={view.next ? href("/home", view.next) : null}
            onPrev={() => go(view.prev)}
            onNext={() => go(view.next)}
            onTitleClick={() => setSheet(true)}
            direction={direction}
            pending={pending}
          />
        </motion.div>
      </header>

      <section aria-label={`Scores for ${view.dateLabel}`} className="relative px-3 pb-6 pt-5">
        <div className="transition-opacity duration-300" style={{ opacity: pending ? 0.45 : 1 }}>
          {/* Not initial={false} on the presence: that would also skip the dials' first sweep. */}
          <AnimatePresence mode="popLayout" custom={direction}>
            <motion.div
              key={view.date}
              custom={direction}
              variants={rowSlide}
              initial={view.date === initialDate && direction === 0 ? false : "enter"}
              animate="center"
              exit="exit"
              transition={reduced ? { duration: 0 } : spring.snappy}
              drag={reduced ? false : "x"}
              dragDirectionLock
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0.22}
              dragSnapToOrigin
              onDragStart={() => {
                dragged.current = true;
              }}
              onDragEnd={(_, info) => {
                window.setTimeout(() => (dragged.current = false), 0);
                const dx = info.offset.x;
                const vx = info.velocity.x;
                if (dx < -SWIPE_DISTANCE || vx < -SWIPE_VELOCITY) go(view.next);
                else if (dx > SWIPE_DISTANCE || vx > SWIPE_VELOCITY) go(view.prev);
              }}
              onClickCapture={(e) => {
                if (dragged.current) {
                  e.preventDefault();
                  e.stopPropagation();
                }
              }}
              className="grid touch-pan-y grid-cols-3"
            >
              <ScoreDial d={view.recovery} label="Recovery" max={100} format="percent" href={href("/recovery")} delay={0.12} />
              <ScoreDial d={view.strain} label="Strain" max={STRAIN_MAX} format="decimal" href={href("/strain")} delay={0.12 + DIAL_STAGGER} />
              <ScoreDial d={view.sleep} label="Sleep" max={100} format="percent" href={href("/sleep")} delay={0.12 + DIAL_STAGGER * 2} />
            </motion.div>
          </AnimatePresence>
        </div>
      </section>

      <Stagger delay={0.45} className="space-y-3 px-4">
        <StaggerItem>
          <Card padding="px-5 pb-2 pt-5">
            <CardHead title="Key stats" meta="vs 30-day avg" />
            <div className="divide-y divide-hairline">
              {view.stats.map((s) => (
                <StatRow
                  key={s.key}
                  label={s.label}
                  value={s.value}
                  unit={s.unit || undefined}
                  baseline={s.baseline}
                  decimals={s.decimals}
                  higherIsBetter={s.higherIsBetter}
                  display={s.display}
                  baselineDisplay={s.baselineDisplay}
                  note={s.note}
                  showDelta={s.showDelta}
                />
              ))}
            </div>
          </Card>
        </StaggerItem>

        <StaggerItem>
          <StrainCard s={view.strainCard} isToday={view.isToday} h12={view.h12} date={view.date} href={href("/strain")} />
        </StaggerItem>

        <StaggerItem>
          <SleepCard s={view.sleepCard} date={view.date} href={href("/sleep")} />
        </StaggerItem>

        <StaggerItem className="px-1 pb-2 pt-3">
          <SyncFooter lastSyncAt={view.lastSyncAt} renderedAt={view.renderedAt} />
        </StaggerItem>
      </Stagger>

      <DateSheet
        open={sheet}
        onClose={() => setSheet(false)}
        selected={view.date}
        today={view.today}
        firstDate={firstDate}
        recovery={calendar}
        onPick={(d) => {
          setSheet(false);
          go(d);
        }}
      />
    </div>
  );
}

