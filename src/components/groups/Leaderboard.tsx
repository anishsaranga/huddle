"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useFlairProps } from "@/components/champions/Flair";
import { Notice } from "@/components/dashboard/bits";
import { DateSwitcher } from "@/components/overview/DateSwitcher";
import { Avatar } from "@/components/ui/Avatar";
import { CountUp } from "@/components/ui/CountUp";
import { EmptyState } from "@/components/ui/EmptyState";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import type { BoardNav } from "@/lib/groups/view";
import type { BoardPeriod } from "@/lib/scores/period";
import { WEEK_MIN_DAYS, type BoardRow, type GroupBoard, type ScoreMetric } from "@/lib/scores/queries";
import { alpha } from "@/lib/ui/colors";
import { spring } from "@/lib/ui/motion";
import { avatarUserOf, fullName, METRIC, metricColor, metricDecimals } from "./metric";
import { Podium } from "./Podium";

const PERIODS: { value: BoardPeriod; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
];

type LeaderboardProps = {
  metric: ScoreMetric;
  board: GroupBoard;
  viewerId: string;
  /** Period / date the controls show (optimistic: may be ahead of `board` while loading). */
  period: BoardPeriod;
  nav: BoardNav;
  /** -1 = moved back in time, 1 = forward (date label slide). */
  direction: number;
  pending: boolean;
  /** This panel is the visible tab. */
  active: boolean;
  /** The panel has been visible at least once (plays the entrance). */
  seen: boolean;
  /** The board shows the current week (offers "last week" while nobody has 4 days yet). */
  currentWeek: boolean;
  onPeriod: (p: BoardPeriod) => void;
  onDate: (date: string, direction: number) => void;
};

/** "=2" when the rank is shared. */
function rankText(row: BoardRow, rows: BoardRow[]): string {
  return rows.filter((r) => r.rank === row.rank).length > 1 ? `=${row.rank}` : String(row.rank);
}

function YouChip() {
  return (
    <span className="telemetry shrink-0 rounded-full bg-white/[0.08] px-1.5 py-[2px] text-[8.5px] leading-none tracking-[0.14em] text-text shadow-[inset_0_0_0_1px_var(--hairline-strong)]">
      YOU
    </span>
  );
}

/** Rank · avatar · name over a value bar (relative to the leader) · value. */
function RankRow({
  row,
  rows,
  metric,
  period,
  leader,
  isYou,
  play,
  pinned = false,
}: {
  row: BoardRow;
  rows: BoardRow[];
  metric: ScoreMetric;
  period: BoardPeriod;
  leader: number;
  isYou: boolean;
  play: boolean;
  pinned?: boolean;
}) {
  const color = metricColor(metric, row.value);
  const ratio = leader > 0 ? Math.min(Math.max(row.value / leader, 0), 1) : 0;
  const decimals = metricDecimals(metric, period);
  // A current weekly champion wears their trophy (this board's title first, if they hold it).
  const flair = useFlairProps(row.userId, { prefer: metric, size: 15, edge: pinned ? "rgb(28 31 36)" : "var(--bg)" });
  return (
    <div
      className={`flex items-center gap-3 rounded-[14px] px-3 py-2.5 ${isYou && !pinned ? "bg-white/[0.045] shadow-[inset_0_0_0_1px_var(--hairline-strong)]" : ""}`}
    >
      <span className="num w-7 shrink-0 text-right font-mono text-[13px] font-semibold text-text-2">{rankText(row, rows)}</span>
      <Avatar user={avatarUserOf(row)} size={40} ring={flair.ring ?? color} badge={flair.badge} alt={flair.label ? `${fullName(row)}. ${flair.label}` : undefined} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="flex min-w-0 items-center gap-1.5 text-[15px] font-semibold leading-tight">
            <span className="truncate">{fullName(row)}</span>
            {isYou && <YouChip />}
          </p>
          <span className="shrink-0 font-display text-[24px] font-semibold leading-none">
            <CountUp
              value={play ? row.value : 0}
              decimals={decimals}
              duration={0.9}
              suffix={METRIC[metric].unit}
              suffixClassName="ml-[1px] text-[0.55em] text-text-2"
            />
          </span>
        </div>
        <div className="mt-2 h-[3px] overflow-hidden rounded-full bg-[var(--track)]">
          <motion.div
            className="h-full origin-left rounded-full"
            style={{ background: `linear-gradient(90deg, ${alpha(color, 55)}, ${color})`, boxShadow: `0 0 8px ${alpha(color, 50)}` }}
            initial={{ scaleX: 0 }}
            animate={{ scaleX: play ? ratio : 0 }}
            transition={{ type: "spring", visualDuration: 0.8, bounce: 0.08 }}
          />
        </div>
        <p className="telemetry mt-1.5 truncate text-[9.5px]">
          {row.username ? `@${row.username}` : ""}
          {period === "week" && (
            <>
              {row.username ? " · " : ""}
              <span className="text-text-2">{row.days}/7</span> DAYS
            </>
          )}
        </p>
      </div>
    </div>
  );
}

const subscribe = () => () => {};

/** Pinned "YOU" row above the tab bar, while the viewer's own entry is scrolled out of view. */
function PinnedYou({ show, children }: { show: boolean; children: React.ReactNode }) {
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  if (!mounted) return null;
  return createPortal(
    <AnimatePresence>
      {show && (
        <motion.div
          className="pointer-events-none fixed inset-x-0 z-40 mx-auto max-w-md px-3"
          style={{ bottom: "calc(var(--tabbar-h) + env(safe-area-inset-bottom) + 10px)" }}
          initial={{ opacity: 0, y: 28 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 28 }}
          transition={spring.sheet}
          data-testid="pinned-you"
        >
          <div className="surface surface-elevated pointer-events-auto rounded-[18px] bg-[rgba(28,31,36,0.92)] p-1 shadow-[0_18px_40px_-12px_rgb(0_0_0/0.9)] backdrop-blur-xl">
            <p className="telemetry absolute -top-2 left-5 rounded-full bg-card-elevated px-1.5 text-[8.5px] tracking-[0.18em] text-text-2">
              YOUR RANK
            </p>
            {children}
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/** Tracks whether the element is inside the scroll viewport (above the tab bar). */
function useInView(target: HTMLElement | null, enabled: boolean): boolean {
  const [inView, setInView] = useState(true);
  useEffect(() => {
    if (!target || !enabled) return;
    const root = target.closest("main");
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), {
      root,
      // The tab bar (58px + home indicator) covers the bottom of the scroller.
      rootMargin: "0px 0px -104px 0px",
      threshold: 0.6,
    });
    io.observe(target);
    return () => io.disconnect();
  }, [target, enabled]);
  return !enabled || !target ? true : inView;
}

export function Leaderboard({
  metric,
  board,
  viewerId,
  period,
  nav,
  direction,
  pending,
  active,
  seen,
  currentWeek,
  onPeriod,
  onDate,
}: LeaderboardProps) {
  const reduced = useReducedMotion();
  const meta = METRIC[metric];
  const rows = board.rows;
  const leader = rows[0]?.value ?? 0;
  const youIndex = rows.findIndex((r) => r.userId === viewerId);
  const you = youIndex >= 0 ? rows[youIndex] : null;
  const [youEl, setYouEl] = useState<HTMLElement | null>(null);
  const youVisible = useInView(youEl, active && !!you);
  const play = seen || !!reduced;
  const isWeek = board.period === "week";

  const emptyCopy = isWeek
    ? `No one has ${WEEK_MIN_DAYS} days of ${meta.noun} this week yet.`
    : `No one has synced ${meta.noun} for this day yet.`;

  return (
    <div className="px-4 pb-24 pt-4">
      {/* Controls */}
      <div className="flex flex-col items-center gap-2">
        <SegmentedControl
          size="sm"
          ariaLabel="Period"
          options={PERIODS}
          value={period}
          onChange={onPeriod}
          className="w-[200px]"
        />
        <DateSwitcher
          title={nav.title}
          dateLabel={nav.sub}
          canPrev={nav.prev !== null}
          canNext={nav.next !== null}
          onPrev={() => nav.prev && onDate(nav.prev, -1)}
          onNext={() => nav.next && onDate(nav.next, 1)}
          direction={direction}
          pending={pending}
          unit={period}
        />
      </div>

      <div
        className="mt-4 transition-opacity duration-300"
        style={{ opacity: pending ? 0.55 : 1 }}
        aria-busy={pending}
        data-testid={`board-${metric}`}
      >
        {rows.length === 0 && board.insufficient.length === 0 ? (
          <EmptyState title={isWeek ? "Not enough data" : "No scores yet"}>{emptyCopy}</EmptyState>
        ) : (
          <>
            {rows.length > 0 ? (
              <Podium rows={rows} metric={metric} period={board.period} viewerId={viewerId} play={play} youRef={setYouEl} />
            ) : (
              <div className="space-y-3">
                <Notice title="Week in progress">
                  Weekly boards rank members with at least {WEEK_MIN_DAYS} days of {meta.noun}.
                  {currentWeek ? " Rankings fill in from Thursday." : ""}
                </Notice>
                {currentWeek && nav.prev && (
                  <button
                    type="button"
                    onClick={() => onDate(nav.prev!, -1)}
                    className="telemetry mx-auto block rounded-full px-4 py-2.5 text-text-2 shadow-[inset_0_0_0_1px_var(--hairline-strong)] transition-transform active:scale-95"
                  >
                    See last week ›
                  </button>
                )}
              </div>
            )}

            {rows.length > 3 && (
              <ul className="mt-4 space-y-1" aria-label={`${meta.label} ranks 4 and below`}>
                <AnimatePresence initial={false} mode="popLayout">
                  {rows.slice(3).map((row, i) => (
                    <motion.li
                      key={row.userId}
                      layout={reduced ? false : "position"}
                      ref={row.userId === viewerId ? setYouEl : undefined}
                      initial={{ opacity: 0, y: 14 }}
                      animate={play ? { opacity: 1, y: 0 } : { opacity: 0, y: 14 }}
                      exit={{ opacity: 0, x: -16, transition: { duration: 0.18 } }}
                      transition={{ ...spring.soft, delay: play ? 0.55 + i * 0.06 : 0 }}
                    >
                      <RankRow
                        row={row}
                        rows={rows}
                        metric={metric}
                        period={board.period}
                        leader={leader}
                        isYou={row.userId === viewerId}
                        play={play}
                      />
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            )}

            {board.insufficient.length > 0 && (
              <section className="mt-6" aria-label="Not enough data">
                <div className="mb-2 flex items-center justify-between px-3">
                  <h3 className="label">Not enough data</h3>
                  <span className="telemetry text-[9.5px]">NEEDS {WEEK_MIN_DAYS} OF 7 DAYS</span>
                </div>
                <ul className="space-y-1 opacity-60">
                  {board.insufficient.map((m) => (
                    <li key={m.userId} className="flex items-center gap-3 px-3 py-2">
                      <Avatar user={avatarUserOf(m)} size={32} />
                      <p className="flex min-w-0 flex-1 items-center gap-1.5 text-[14px] font-medium text-text-2">
                        <span className="truncate">{fullName(m)}</span>
                        {m.userId === viewerId && <YouChip />}
                      </p>
                      <span className="telemetry shrink-0">
                        <span className="text-text-2">{m.days}/7</span> DAYS
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>

      {you && (
        <PinnedYou show={active && !youVisible}>
          <RankRow row={you} rows={rows} metric={metric} period={board.period} leader={leader} isYou play pinned />
        </PinnedYou>
      )}
    </div>
  );
}

