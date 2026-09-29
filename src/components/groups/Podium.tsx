"use client";

import { AnimatePresence, motion, useReducedMotion, type Variants } from "motion/react";
import type { Ref } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { CountUp } from "@/components/ui/CountUp";
import type { BoardPeriod } from "@/lib/scores/period";
import type { BoardRow, ScoreMetric } from "@/lib/scores/queries";
import { alpha } from "@/lib/ui/colors";
import { avatarUserOf, firstName, formatMetric, METRIC, metricColor, metricDecimals } from "./metric";

/*
 * Ranks 1-3 on plinths: #2 left, #1 center (bigger, raised, spotlit), #3
 * right. Entrance (when `play` first turns true): the plinths rise from the
 * floor 3 → 2 → 1, each member drops onto theirs, #1 lands last with a pop,
 * then the spotlight comes up. Later board changes keep the slots mounted:
 * values count from the previous number and a new occupant crossfades in.
 */

/** Visual slot order, left to right: board index 1, 0, 2. */
const SLOTS = [1, 0, 2] as const;

const GEO = [
  // index 0 = the leader
  { avatar: 72, plinth: 74, value: 40, delay: 0.32 },
  { avatar: 54, plinth: 52, value: 28, delay: 0.14 },
  { avatar: 54, plinth: 36, value: 28, delay: 0.04 },
] as const;

const plinthVariants: Variants = {
  hidden: { scaleY: 0, opacity: 0 },
  show: (i: number) => ({
    scaleY: 1,
    opacity: 1,
    transition: {
      scaleY: { type: "spring", visualDuration: 0.55, bounce: 0.18, delay: GEO[i].delay },
      opacity: { duration: 0.2, delay: GEO[i].delay },
    },
  }),
};

const memberVariants: Variants = {
  hidden: (i: number) => ({ opacity: 0, y: 26, scale: i === 0 ? 0.55 : 0.85 }),
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    scale: 1,
    transition:
      i === 0
        ? {
            // The leader lands last and overshoots a touch.
            y: { type: "spring", stiffness: 380, damping: 17, delay: GEO[0].delay + 0.16 },
            scale: { type: "spring", stiffness: 420, damping: 13, delay: GEO[0].delay + 0.16 },
            opacity: { duration: 0.2, delay: GEO[0].delay + 0.16 },
          }
        : {
            type: "spring",
            visualDuration: 0.5,
            bounce: 0.2,
            delay: GEO[i].delay + 0.12,
          },
  }),
};

const spotVariants: Variants = {
  hidden: { opacity: 0, scaleX: 0.6 },
  show: { opacity: 1, scaleX: 1, transition: { duration: 0.9, delay: 0.62, ease: [0.16, 1, 0.3, 1] } },
};

function Crown({ color }: { color: string }) {
  return (
    <svg aria-hidden width="22" height="16" viewBox="0 0 22 16" className="drop-shadow-[0_0_6px_var(--c)]" style={{ "--c": color } as React.CSSProperties}>
      <path
        d="M2 5.5 6.6 9.4 11 2l4.4 7.4L20 5.5 18.4 14H3.6z"
        stroke="var(--bg)"
        strokeWidth="1.2"
        strokeLinejoin="round"
        style={{ fill: color }}
      />
    </svg>
  );
}

function RankChip({ rank, color, big }: { rank: number; color: string; big?: boolean }) {
  return (
    <span
      className={`num grid place-items-center rounded-full font-mono font-bold leading-none text-bg ${big ? "size-[24px] text-[12px]" : "size-[20px] text-[10.5px]"}`}
      style={{ background: color, boxShadow: `0 0 0 2.5px var(--bg), 0 0 10px ${alpha(color, 60)}` }}
    >
      {rank}
    </span>
  );
}

type PodiumProps = {
  rows: BoardRow[];
  metric: ScoreMetric;
  period: BoardPeriod;
  viewerId: string;
  /** Start (or skip to) the entrance. Stays shown once played. */
  play: boolean;
  /** Attached to the viewer's slot (for the pinned YOU row). */
  youRef?: Ref<HTMLDivElement>;
};

export function Podium({ rows, metric, period, viewerId, play, youRef }: PodiumProps) {
  const reduced = useReducedMotion();
  const top = rows.slice(0, 3);
  const leadColor = metricColor(metric, top[0]?.value);
  const decimals = metricDecimals(metric, period);
  const unit = METRIC[metric].unit;

  return (
    <motion.div
      className="relative isolate px-2"
      initial={reduced ? "show" : "hidden"}
      animate={play || reduced ? "show" : "hidden"}
      role="list"
      aria-label={`Top ${top.length}`}
    >
      {/* Spotlight: a soft beam from above onto #1, and a pool of light on its plinth. */}
      <motion.div aria-hidden variants={spotVariants} className="pointer-events-none absolute inset-x-0 top-0 bottom-0 -z-10 origin-top">
        <div
          className="absolute left-1/2 top-0 h-full w-[360px] -translate-x-1/2"
          style={{
            // A cone from a point above the leader: soft angular edges, fading toward the floor.
            background: `conic-gradient(from 157deg at 50% -8%, transparent 0deg, ${alpha(leadColor, 34)} 23deg, transparent 46deg)`,
            maskImage: "linear-gradient(180deg, transparent 0%, #000 18%, #000 45%, transparent 92%)",
            WebkitMaskImage: "linear-gradient(180deg, transparent 0%, #000 18%, #000 45%, transparent 92%)",
          }}
        />
        <div
          className="absolute left-1/2 top-[34%] h-[150px] w-[260px] -translate-x-1/2"
          style={{ background: `radial-gradient(ellipse 50% 50% at 50% 50%, ${alpha(leadColor, 22)}, transparent 70%)` }}
        />
      </motion.div>

      <div className="grid grid-cols-3 items-end gap-2">
        {SLOTS.map((i) => {
          const row = top[i];
          const g = GEO[i];
          const color = row ? metricColor(metric, row.value) : "var(--dim)";
          const isYou = row?.userId === viewerId;
          const tied = row ? rows.filter((r) => r.rank === row.rank).length > 1 : false;
          return (
            <div key={i} role="listitem" className="flex min-w-0 flex-col items-center" ref={isYou ? youRef : undefined}>
              <motion.div custom={i} variants={memberVariants} className="flex w-full min-w-0 flex-col items-center pb-2.5">
                <AnimatePresence mode="popLayout" initial={false}>
                  {row ? (
                    <motion.div
                      key={row.userId}
                      className="flex w-full min-w-0 flex-col items-center"
                      // A new occupant dissolves in over the old one (same spot), with a small pop.
                      initial={{ opacity: 0, scale: 0.86 }}
                      animate={{
                        opacity: 1,
                        scale: 1,
                        transition: { opacity: { duration: 0.22 }, scale: { type: "spring", visualDuration: 0.42, bounce: 0.3 } },
                      }}
                      exit={{ opacity: 0, transition: { duration: 0.16 } }}
                    >
                      <div className="mb-1.5 h-4">{row.rank === 1 && <Crown color={color} />}</div>
                      <Avatar
                        user={avatarUserOf(row)}
                        size={g.avatar}
                        ring={color}
                        alt={`${firstName(row)}, rank ${row.rank}`}
                        badge={<RankChip rank={row.rank} color={color} big={i === 0} />}
                      />
                      <p className="mt-2.5 flex max-w-full items-center gap-1 px-1 text-[13px] font-semibold leading-tight">
                        <span className="truncate">{firstName(row)}</span>
                        {isYou && <span className="telemetry shrink-0 text-[8.5px]! text-text-2!">· YOU</span>}
                      </p>
                    </motion.div>
                  ) : (
                    <motion.div key="empty" className="flex flex-col items-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                      <div className="mb-1.5 h-4" />
                      <span
                        className="grid place-items-center rounded-full border border-dashed border-hairline-strong text-dim"
                        style={{ width: g.avatar, height: g.avatar }}
                      >
                        —
                      </span>
                      <p className="telemetry mt-3 text-dim!">OPEN</p>
                    </motion.div>
                  )}
                </AnimatePresence>
                <p
                  className="mt-1 flex items-baseline font-display font-semibold leading-none"
                  style={{ fontSize: g.value, color: row ? undefined : "var(--dim)" }}
                  aria-label={row ? `${tied ? "Tied, " : ""}${formatMetric(metric, row.value, period)}` : undefined}
                >
                  {row ? (
                    <CountUp
                      value={play ? row.value : 0}
                      decimals={decimals}
                      delay={play ? g.delay + 0.2 : 0}
                      duration={1}
                      suffix={unit}
                      suffixClassName="ml-[1px] text-[0.5em] text-text-2"
                    />
                  ) : (
                    <span className="num">—</span>
                  )}
                </p>
                {period === "week" && row && <p className="telemetry mt-1 text-[9px]!">{row.days}/7 DAYS</p>}
              </motion.div>

              {/* Plinth */}
              <motion.div
                aria-hidden
                custom={i}
                variants={plinthVariants}
                className="relative w-full origin-bottom overflow-hidden rounded-t-[14px]"
                style={{
                  height: g.plinth,
                  background: `linear-gradient(180deg, ${alpha(color, i === 0 ? 30 : 18)} 0%, ${alpha(color, 6)} 55%, transparent 100%)`,
                  boxShadow: `inset 0 1.5px 0 ${alpha(color, 85)}, 0 -10px 24px -14px ${alpha(color, 80)}`,
                }}
              >
                <span
                  className="num absolute inset-x-0 top-1.5 text-center font-display font-bold leading-none text-white/[0.13]"
                  style={{ fontSize: i === 0 ? 44 : 32 }}
                >
                  {row?.rank ?? i + 1}
                </span>
              </motion.div>
            </div>
          );
        })}
      </div>
      {/* Floor line the plinths stand on. */}
      <div aria-hidden className="h-px bg-[linear-gradient(90deg,transparent,var(--hairline-strong),transparent)]" />
    </motion.div>
  );
}
