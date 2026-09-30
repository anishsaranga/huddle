"use client";

import { motion, useInView, useReducedMotion, type Variants } from "motion/react";
import { useRef } from "react";
import { MessageText } from "@/components/chat/MessageText";
import { useChatTab } from "@/components/chat/ChatTabContext";
import { Avatar } from "@/components/ui/Avatar";
import { CountUp } from "@/components/ui/CountUp";
import {
  CATEGORY_META,
  parseChampionsPayload,
  type ChampionCategoryResult,
  type ChampionEntry,
} from "@/lib/champions/types";
import { alpha, recoveryColor } from "@/lib/ui/colors";
import { formatNumber } from "@/lib/ui/format";
import { PRESS_SCALE, spring } from "@/lib/ui/motion";
import { TrophyGlyph } from "./Flair";

type ChampionsCardProps = { body: string; payload: Record<string, unknown> | null; time: string };

/** Signal hairline across the card's top edge: the three score colors. */
const SPECTRUM = "linear-gradient(90deg, transparent 0%, var(--sleep) 18%, var(--recovery-green) 50%, var(--strain) 82%, transparent 100%)";

const cardVariants: Variants = {
  hidden: { opacity: 0, y: 22, scale: 0.97 },
  show: { opacity: 1, y: 0, scale: 1, transition: { type: "spring", visualDuration: 0.55, bounce: 0.14 } },
};

const rowVariants: Variants = {
  hidden: { opacity: 0, x: -10 },
  show: (i: number) => ({ opacity: 1, x: 0, transition: { type: "spring", visualDuration: 0.45, bounce: 0.1, delay: 0.28 + i * 0.09 } }),
};

const winnerVariants: Variants = {
  hidden: { opacity: 0, scale: 0.4 },
  show: (i: number) => ({
    opacity: 1,
    scale: 1,
    transition: { type: "spring", stiffness: 460, damping: 15, delay: 0.36 + i * 0.09 },
  }),
};

/** Neutral stand-in for a champion whose account was deleted. */
function GhostAvatar({ size }: { size: number }) {
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-full bg-card-sunken text-dim shadow-[inset_0_0_0_1px_var(--hairline-strong)]"
      style={{ width: size, height: size }}
    >
      <svg width={size * 0.45} height={size * 0.45} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <circle cx="12" cy="8.5" r="3.6" />
        <path d="M4.5 20c.6-3.9 3.7-6 7.5-6s6.9 2.1 7.5 6" />
      </svg>
    </span>
  );
}

const personOf = (e: ChampionEntry) => ({
  id: e.userId,
  displayName: e.displayName,
  username: e.username,
  avatarKind: e.avatarKind,
  avatarConfig: e.avatarConfig,
  avatarPath: e.avatarPath,
});

function RunnerUp({ entry, place, category, deleted }: { entry: ChampionEntry; place: number; category: ChampionCategoryResult["category"]; deleted: boolean }) {
  const meta = CATEGORY_META[category];
  return (
    <span className="flex min-w-0 items-center gap-1">
      <span className="num font-mono text-[9.5px] font-semibold text-dim">{place}</span>
      {deleted ? <GhostAvatar size={16} /> : <Avatar user={personOf(entry)} size={16} />}
      <span className={`min-w-0 truncate text-[11.5px] font-medium ${deleted ? "italic text-muted" : "text-text-2"}`}>
        {deleted ? "Deleted user" : entry.displayName.split(/\s+/)[0]}
      </span>
      <span className="num shrink-0 font-mono text-[10px] text-muted">
        {category === "improved" ? "+" : ""}
        {formatNumber(entry.value, meta.decimals)}
      </span>
    </span>
  );
}

function CategoryRow({
  result,
  index,
  weekStart,
  deleted,
  play,
}: {
  result: ChampionCategoryResult;
  index: number;
  weekStart: string;
  deleted: ReadonlySet<string>;
  play: boolean;
}) {
  const { openBoard } = useChatTab();
  const meta = CATEGORY_META[result.category];
  const winner = result.winners[0];
  const gone = deleted.has(winner.userId);
  const color = meta.color;
  const board = meta.board;
  const tappable = !!(board && openBoard);
  // Numbers keep their usual meaning: a recovery value takes its band color (like the boards).
  const valueColor = result.category === "steps" ? "var(--text)" : result.category === "recovery" ? recoveryColor(winner.value) : color;

  const runnersUp =
    result.runnersUp.length > 0 ? (
      <span className="mt-1 flex min-w-0 items-center gap-4 pl-[58px] pr-5">
        {result.runnersUp.map((r, i) => (
          <RunnerUp key={r.userId} entry={r} place={i + 2} category={result.category} deleted={deleted.has(r.userId)} />
        ))}
      </span>
    ) : null;

  const main = (
    <>
      <motion.span custom={index} variants={winnerVariants} className="relative shrink-0">
        {gone ? (
          <GhostAvatar size={46} />
        ) : (
          <Avatar
            user={personOf(winner)}
            size={46}
            ring={color}
            alt={`${winner.displayName}, ${meta.title}`}
            badge={
              <span
                className="grid size-[18px] place-items-center rounded-full"
                style={{ background: color, boxShadow: `0 0 0 2px var(--card-elevated), 0 0 10px ${alpha(color, 60)}` }}
              >
                <TrophyGlyph size={11} />
              </span>
            }
          />
        )}
      </motion.span>

      <span className="min-w-0 flex-1">
        <span className="telemetry flex items-center gap-1.5 text-[9.5px] tracking-[0.14em]" style={{ color }}>
          {result.category === "improved" ? (
            <svg aria-hidden width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 9.5 6 5.5l2 2L10.5 3M7.5 3h3v3" />
            </svg>
          ) : (
            <span aria-hidden className="size-[6px] rounded-full" style={{ background: color, boxShadow: `0 0 6px ${alpha(color, 70)}` }} />
          )}
          {meta.title}
        </span>
        <span className={`mt-0.5 block truncate text-[16px] font-semibold leading-tight ${gone ? "italic text-muted" : "text-text"}`}>
          {gone ? "Deleted user" : winner.displayName}
        </span>
      </span>

      <span className="flex shrink-0 flex-col items-end">
        <span className="flex items-baseline font-display font-semibold leading-none" style={{ color: valueColor, fontSize: result.category === "steps" ? 24 : 30 }}>
          {result.category === "improved" && <span className="text-[0.6em]">+</span>}
          <CountUp value={play ? winner.value : 0} decimals={meta.decimals} delay={0.4 + index * 0.09} duration={1} />
          {meta.unit === "%" && <span className="ml-[1px] text-[0.5em] text-text-2">%</span>}
          {meta.unit === "pts" && <span className="ml-1 font-mono text-[0.34em] font-medium tracking-[0.08em] text-text-2">PTS</span>}
        </span>
        <span className="telemetry mt-1 text-[9px]">
          {result.category === "steps"
            ? "STEPS"
            : result.category === "improved" && winner.from !== undefined && winner.to !== undefined
              ? `${formatNumber(winner.from, 0)} → ${formatNumber(winner.to, 0)}%`
              : result.category === "strain"
                ? "AVG STRAIN"
                : "WEEK AVG"}
        </span>
      </span>

      {tappable && (
        <svg aria-hidden width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="-mr-1 shrink-0 text-dim">
          <path d="m6 3.5 4.5 4.5L6 12.5" />
        </svg>
      )}
    </>
  );

  return (
    <motion.li custom={index} variants={rowVariants} className="border-t border-hairline first:border-t-0" data-category={result.category}>
      {tappable ? (
        <motion.button
          type="button"
          onClick={() => openBoard!(board!, weekStart)}
          whileTap={{ scale: PRESS_SCALE }}
          transition={spring.press}
          aria-label={`${meta.title}: ${gone ? "Deleted user" : winner.displayName}. Open the ${meta.label.toLowerCase()} board for that week`}
          className="block w-full px-4 py-3 text-left active:bg-white/[0.03]"
        >
          <span className="flex w-full items-center gap-3">{main}</span>
          {runnersUp}
        </motion.button>
      ) : (
        <div className="px-4 py-3">
          <div className="flex w-full items-center gap-3">{main}</div>
          {runnersUp}
        </div>
      )}
    </motion.li>
  );
}

/**
 * Weekly champions post (`kind = "champions"`): header with the week, the
 * AI (or template) text, then one row per category: the winner's avatar with
 * a category ring and trophy, their value and the runners-up. Rows jump to
 * that week's board. Plays its entrance when first scrolled into view (the
 * card rises, winners pop in one after another).
 */
export function ChampionsCard({ body, payload, time }: ChampionsCardProps) {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.25 });
  const reduced = useReducedMotion();
  const data = parseChampionsPayload(payload);
  const deleted = new Set(data?.deletedUserIds ?? []);
  const play = inView || !!reduced;

  return (
    <motion.article
      ref={ref}
      data-testid="champions-card"
      initial={reduced ? "show" : "hidden"}
      animate={play ? "show" : "hidden"}
      variants={cardVariants}
      className="surface surface-elevated relative isolate overflow-hidden"
      aria-label={`Weekly champions${data ? `, ${data.weekLabel}` : ""}`}
    >
      <span aria-hidden className="absolute inset-x-0 top-0 h-[1.5px] opacity-90" style={{ background: SPECTRUM }} />
      <span
        aria-hidden
        className="pointer-events-none absolute -top-24 left-1/2 -z-10 h-48 w-[130%] -translate-x-1/2"
        style={{ background: "radial-gradient(ellipse 50% 50% at 50% 50%, rgb(140 155 255 / 0.12), rgb(43 214 123 / 0.05) 45%, transparent 70%)" }}
      />

      <header className="flex items-center justify-between gap-3 px-4 pt-4">
        <span className="telemetry flex min-w-0 items-center gap-2 text-text">
          <span className="grid size-[18px] shrink-0 place-items-center rounded-full bg-white shadow-[0_0_12px_rgb(255_255_255/0.35)]">
            <TrophyGlyph size={11} />
          </span>
          <span className="truncate tracking-[0.14em]">
            WEEKLY CHAMPIONS{data ? <span className="text-muted"> · {data.weekLabel}</span> : null}
          </span>
        </span>
        <span className="telemetry shrink-0 text-[9.5px]">{time}</span>
      </header>

      {body && (
        <p className="whitespace-pre-wrap break-words px-4 pt-3 text-[15px] leading-[1.5] text-text [overflow-wrap:anywhere]">
          <MessageText text={body} />
        </p>
      )}

      {data && data.categories.length > 0 && (
        <ul className="mx-2 mb-2 mt-4 overflow-hidden rounded-[14px] bg-card-sunken/70 shadow-[inset_0_0_0_1px_var(--hairline)]">
          {data.categories.map((c, i) => (
            <CategoryRow key={c.category} result={c} index={i} weekStart={data.weekStart} deleted={deleted} play={play} />
          ))}
        </ul>
      )}

      {data?.source === "gemini" && (
        <p className="telemetry px-4 pb-3 text-right text-[8.5px] text-dim">✦ WRITTEN WITH GEMINI</p>
      )}
      {(!data || data.source !== "gemini") && <div className="h-1" />}
    </motion.article>
  );
}
