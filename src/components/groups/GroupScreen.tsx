"use client";

import { useRouter } from "next/navigation";
import { useOptimistic, useRef, useState, useTransition, type ReactNode } from "react";
import { AmbientGlow } from "@/components/ui/AmbientGlow";
import { TopTabs } from "@/components/ui/TopTabs";
import { boardNav, groupQuery, type GroupPageState, type GroupTab } from "@/lib/groups/view";
import { boardRange, type BoardPeriod } from "@/lib/scores/period";
import type { GroupBoard, ScoreMetric } from "@/lib/scores/queries";
import { NEUTRAL_SIGNAL, recoveryColorOrNeutral, SIGNAL } from "@/lib/ui/colors";
import { Leaderboard } from "./Leaderboard";

const TAB_LABELS: { id: GroupTab; label: string }[] = [
  { id: "info", label: "Info" },
  { id: "chat", label: "Chat" },
  { id: "strain", label: "Strain" },
  { id: "recovery", label: "Recovery" },
  { id: "sleep", label: "Sleep" },
];

const isBoard = (t: GroupTab): t is ScoreMetric => t === "strain" || t === "recovery" || t === "sleep";

type GroupScreenProps = {
  groupId: string;
  /** The group's today (today in the group's timezone): the default date and the upper bound for navigation. */
  today: string;
  /** Earliest date with any member score (bounds ‹). */
  firstDate: string | null;
  viewerId: string;
  /** Parsed from the URL on the server. */
  state: GroupPageState;
  boards: Record<ScoreMetric, GroupBoard>;
  header: ReactNode;
  info: ReactNode;
  /** Chat panel slot (T7.1). */
  chat: ReactNode;
  /** Ambient color behind the Info tab (the group's average recovery band). */
  infoGlow: string;
};

/**
 * Group page shell: header, swipeable Info · Chat · Strain · Recovery · Sleep
 * panels and the shared leaderboard period/date. The tab lives in the URL
 * via history.replaceState (no server round trip); period/date changes go
 * through router.replace in a transition, so the page stays mounted, the
 * controls update optimistically and the boards animate to the new values.
 */
export function GroupScreen({ groupId, today, firstDate, viewerId, state, boards, header, info, chat, infoGlow }: GroupScreenProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [tab, setTab] = useState<GroupTab>(state.tab);
  const tabRef = useRef<GroupTab>(state.tab);
  const [seen, setSeen] = useState<ReadonlySet<GroupTab>>(() => new Set([state.tab]));
  const [nav, setNav] = useOptimistic<{ period: BoardPeriod; date: string }>({ period: state.period, date: state.date });
  const [direction, setDirection] = useState(0);

  const hrefFor = (t: GroupTab, period: BoardPeriod, date: string) =>
    `/groups/${groupId}${groupQuery({ tab: t, period, date }, today)}`;

  const onTab = (i: number) => {
    const t = TAB_LABELS[i].id;
    tabRef.current = t;
    setTab(t);
    setSeen((s) => (s.has(t) ? s : new Set(s).add(t)));
    window.history.replaceState(window.history.state, "", hrefFor(t, nav.period, nav.date));
  };

  const go = (period: BoardPeriod, date: string, dir: number) => {
    setDirection(dir);
    startTransition(() => {
      setNav({ period, date });
      router.replace(hrefFor(tabRef.current, period, date), { scroll: false });
    });
  };

  const bnav = boardNav(nav.period, nav.date, today, firstDate);
  const currentWeek = nav.period === "week" && boardRange("week", nav.date).from === boardRange("week", today).from;

  const recoveryRows = boards.recovery.rows;
  const glow =
    tab === "info"
      ? infoGlow
      : tab === "chat"
        ? NEUTRAL_SIGNAL
        : tab === "recovery"
          ? recoveryColorOrNeutral(
              recoveryRows.length ? recoveryRows.reduce((a, r) => a + r.value, 0) / recoveryRows.length : null,
            )
          : tab === "strain"
            ? SIGNAL.strain
            : SIGNAL.sleep;

  const tabs = TAB_LABELS.map(({ id, label }) => ({
    id,
    label,
    content:
      id === "info" ? (
        info
      ) : id === "chat" ? (
        chat
      ) : isBoard(id) ? (
        <Leaderboard
          metric={id}
          board={boards[id]}
          viewerId={viewerId}
          period={nav.period}
          nav={bnav}
          direction={direction}
          pending={pending}
          active={tab === id}
          seen={seen.has(id)}
          currentWeek={currentWeek}
          onPeriod={(p) => p !== nav.period && go(p, nav.date, 0)}
          onDate={(d, dir) => go(nav.period, d, dir)}
        />
      ) : null,
  }));

  return (
    <div className="relative isolate">
      <AmbientGlow color={glow} intensity={0.75} />
      {header}
      <TopTabs fill tabs={tabs} defaultIndex={TAB_LABELS.findIndex((t) => t.id === state.tab)} onChange={onTab} />
    </div>
  );
}
