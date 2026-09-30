"use client";

import { motion } from "motion/react";
import { useState } from "react";
import { flairProps, useFlair, useFlairMap } from "@/components/champions/Flair";
import { Dial } from "@/components/charts/Dial";
import { TrendBars } from "@/components/charts/TrendBars";
import { CardHead } from "@/components/dashboard/bits";
import { Avatar } from "@/components/ui/Avatar";
import { Card } from "@/components/ui/Card";
import { Sheet } from "@/components/ui/Sheet";
import { Stagger, StaggerItem } from "@/components/ui/Stagger";
import type { GroupToday, TodayScores } from "@/lib/groups/view";
import type { ScoreMetric } from "@/lib/scores/queries";
import { CATEGORY_META } from "@/lib/champions/types";
import { alpha, recoveryColorOrNeutral } from "@/lib/ui/colors";
import { formatNumber } from "@/lib/ui/format";
import { DIAL_STAGGER, PRESS_SCALE, spring } from "@/lib/ui/motion";
import { avatarUserOf, firstName, fullName, METRIC, metricColor, metricDecimals } from "./metric";
import type { GroupTrendBar, MemberView } from "./types";

const ORDER: ScoreMetric[] = ["recovery", "strain", "sleep"];
const SHORT: Record<ScoreMetric, string> = { recovery: "REC", strain: "STRAIN", sleep: "SLEEP" };

function ScoreDials({ scores, footers, delay = 0 }: { scores: TodayScores; footers?: Partial<Record<ScoreMetric, string>>; delay?: number }) {
  return (
    <div className="grid grid-cols-3">
      {ORDER.map((m, i) => {
        const v = scores[m];
        const hollow = v === null;
        return (
          <div key={m} className="flex justify-center">
            <Dial
              // 96px keeps three rings clear of each other on a 375pt phone.
              size={96}
              value={v ?? 0}
              max={METRIC[m].max}
              color={metricColor(m, v)}
              label={METRIC[m].label}
              format={m === "strain" ? "decimal" : "percent"}
              display={hollow ? "—" : undefined}
              hollow={hollow}
              delay={delay + i * DIAL_STAGGER}
              ariaLabel={`${METRIC[m].label}: ${hollow ? "no data" : `${formatNumber(v, metricDecimals(m))}${METRIC[m].unit}`}`}
              footer={
                footers?.[m] ? <span className="telemetry -mt-1 text-[9px]">{footers[m]}</span> : undefined
              }
            />
          </div>
        );
      })}
    </div>
  );
}

function MiniScore({ metric, value }: { metric: ScoreMetric; value: number | null }) {
  return (
    <span
      className="num w-[38px] shrink-0 text-right font-display text-[18px] font-semibold leading-none"
      style={{ color: value === null ? "var(--dim)" : metricColor(metric, value) }}
    >
      {value === null ? "—" : formatNumber(value, metricDecimals(metric))}
      {value !== null && METRIC[metric].unit && <span className="text-[0.55em] text-text-2">%</span>}
    </span>
  );
}

function MemberSheet({ member, open, onClose }: { member: MemberView | null; open: boolean; onClose: () => void }) {
  const titles = useFlair(member?.userId);
  const champ = flairProps(titles, { size: 24, edge: "var(--card-elevated)" });
  return (
    <Sheet open={open && member !== null} onClose={onClose} title={member ? fullName(member) : undefined}>
      {member && (
        <div className="pb-2">
          <div className="flex items-center gap-4 pt-2">
            <Avatar
              user={avatarUserOf(member)}
              size="xl"
              ring={champ.ring ?? (member.scores.recovery !== null ? recoveryColorOrNeutral(member.scores.recovery) : undefined)}
              badge={champ.badge}
            />
            <div className="min-w-0 space-y-1.5">
              {member.username && <p className="truncate text-[15px] text-text-2">@{member.username}</p>}
              <p className="telemetry truncate">{member.timezone}</p>
              <p className="telemetry flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="size-[6px] rounded-full"
                  style={{ background: member.hasData ? "var(--recovery-green)" : "var(--dim)" }}
                />
                {member.lastSynced ? `SYNCED ${member.lastSynced.toUpperCase()}` : "NEVER SYNCED"}
              </p>
              {titles.length > 0 && (
                <p className="flex flex-wrap gap-1.5 pt-0.5">
                  {titles.map((c) => (
                    <span
                      key={c}
                      className="telemetry rounded-full px-2 py-[3px] text-[8.5px] tracking-[0.12em]"
                      style={{ color: CATEGORY_META[c].color, background: alpha(CATEGORY_META[c].color, 12), boxShadow: `inset 0 0 0 1px ${alpha(CATEGORY_META[c].color, 35)}` }}
                    >
                      {CATEGORY_META[c].title}
                    </span>
                  ))}
                </p>
              )}
            </div>
          </div>
          <div className="mt-7 flex items-center justify-between">
            <h3 className="label text-text-2">Their scores</h3>
            <span className="telemetry">{member.todayLabel}</span>
          </div>
          <div className="mt-5">
            <ScoreDials scores={member.scores} delay={0.15} />
          </div>
        </div>
      )}
    </Sheet>
  );
}

type InfoPanelProps = {
  members: MemberView[];
  today: GroupToday;
  trend: GroupTrendBar[];
  trendAvg: number | null;
  viewerId: string;
  /** The group date and timezone, e.g. "TODAY · SEP 29 · EUROPE/BERLIN". */
  dateContext: string;
};

export function InfoPanel({ members, today, trend, trendAvg, viewerId, dateContext }: InfoPanelProps) {
  // The last opened member stays set while the sheet animates out.
  const [selected, setSelected] = useState<MemberView | null>(null);
  const [open, setOpen] = useState(false);
  const flair = useFlairMap();
  const avgScores: TodayScores = { recovery: today.recovery.value, strain: today.strain.value, sleep: today.sleep.value };
  const footers = Object.fromEntries(
    ORDER.map((m) => [m, today[m].n > 0 ? `${today[m].n} OF ${today.total}` : "NO DATA"]),
  ) as Record<ScoreMetric, string>;
  const hasTrend = trend.some((b) => b.value !== null);

  return (
    <Stagger className="space-y-3 px-4 pb-6 pt-4" delay={0.05}>
      <StaggerItem>
        <p className="telemetry px-1" data-testid="group-date-context">
          {dateContext}
        </p>
      </StaggerItem>

      <StaggerItem>
        <Card glow={recoveryColorOrNeutral(today.recovery.value)}>
          <CardHead
            title="Group today"
            meta={
              <span>
                <span className="text-text">{today.synced}</span> OF {today.total} SYNCED
              </span>
            }
          />
          <ScoreDials scores={avgScores} footers={footers} delay={0.1} />

          <div className="mt-5 border-t border-hairline pt-4">
            <p className="telemetry mb-3">Synced today</p>
            <ul className="no-scrollbar -mx-1 flex justify-between gap-1 overflow-x-auto px-1" aria-label="Who has synced today">
              {members.map((m) => (
                <li key={m.userId} className="flex w-[46px] shrink-0 flex-col items-center gap-1.5">
                  <span
                    className="relative transition-opacity"
                    style={{ opacity: m.hasData ? 1 : 0.32, filter: m.hasData ? undefined : "grayscale(1)" }}
                  >
                    <Avatar
                      user={avatarUserOf(m)}
                      size={34}
                      alt={`${fullName(m)}: ${m.hasData ? "synced today" : "not synced today"}`}
                      badge={
                        m.hasData ? (
                          <span className="grid size-[14px] place-items-center rounded-full bg-recovery-green shadow-[0_0_0_2px_var(--card)]">
                            <svg aria-hidden width="8" height="8" viewBox="0 0 8 8">
                              <path d="M1.6 4.2 3.2 5.8 6.4 2.4" fill="none" stroke="var(--bg)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </span>
                        ) : undefined
                      }
                    />
                  </span>
                  <span className={`w-full truncate text-center text-[10.5px] font-medium ${m.hasData ? "text-text-2" : "text-dim"}`}>
                    {firstName(m)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      </StaggerItem>

      <StaggerItem>
        <Card padding="px-2 pb-2 pt-5">
          <div className="px-3">
            <CardHead title="Members" meta={<span>{members.length}</span>} className="mb-2" />
            <div className="flex justify-end gap-0.5 pb-1 pr-3" aria-hidden>
              {ORDER.map((m) => (
                <span key={m} className="telemetry w-[38px] text-right text-[8px] tracking-[0.05em]">
                  {SHORT[m]}
                </span>
              ))}
            </div>
          </div>
          <ul>
            {members.map((m) => {
              const band = m.scores.recovery !== null ? recoveryColorOrNeutral(m.scores.recovery) : undefined;
              const champ = flairProps(flair[m.userId] ?? [], { size: 15, edge: "var(--card)" });
              return (
                <li key={m.userId}>
                  <motion.button
                    type="button"
                    onClick={() => {
                      setSelected(m);
                      setOpen(true);
                    }}
                    whileTap={{ scale: PRESS_SCALE }}
                    transition={spring.press}
                    className={`flex w-full items-center gap-2.5 rounded-[14px] px-3 py-2.5 text-left active:bg-white/[0.03] ${m.userId === viewerId ? "bg-white/[0.035]" : ""}`}
                    aria-label={`${fullName(m)}. ${champ.label ? `${champ.label}. ` : ""}Today: recovery ${m.scores.recovery ?? "none"}, strain ${m.scores.strain ?? "none"}, sleep ${m.scores.sleep ?? "none"}. ${m.lastSynced ? `Synced ${m.lastSynced}` : "Never synced"}`}
                  >
                    <Avatar user={avatarUserOf(m)} size={36} ring={champ.ring ?? band} badge={champ.badge} />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 text-[15px] font-semibold leading-tight">
                        <span className="truncate">{fullName(m)}</span>
                        {m.userId === viewerId && (
                          <span className="telemetry shrink-0 rounded-full bg-white/[0.08] px-1.5 py-[2px] text-[8px] leading-none text-text">
                            YOU
                          </span>
                        )}
                      </p>
                      <p className="telemetry mt-1 flex min-w-0 items-center gap-1 text-[9.5px]">
                        {m.username && <span className="min-w-0 truncate">@{m.username}</span>}
                        {m.username && <span aria-hidden className="shrink-0">·</span>}
                        <span className={`shrink-0 ${m.hasData ? "text-text-2" : ""}`}>
                          {m.lastSynced ? m.lastSynced.toUpperCase() : "NEVER"}
                        </span>
                      </p>
                    </div>
                    <div className="flex shrink-0 items-baseline gap-0.5">
                      {ORDER.map((k) => (
                        <MiniScore key={k} metric={k} value={m.scores[k]} />
                      ))}
                    </div>
                  </motion.button>
                </li>
              );
            })}
          </ul>
        </Card>
      </StaggerItem>

      {hasTrend && (
        <StaggerItem>
          <Card>
            <CardHead
              title="Group recovery"
              meta={
                <span>
                  1W · AVG{" "}
                  <span className="text-text-2">{trendAvg !== null ? `${formatNumber(trendAvg, 0)}%` : "—"}</span>
                </span>
              }
            />
            <TrendBars
              data={trend}
              max={100}
              height={120}
              gap={8}
              showValues
              delay={0.25}
              ariaLabel={`Group average recovery, last 7 days: ${trend
                .map((b) => `${b.title} ${b.value !== null ? `${Math.round(b.value)}%` : "no data"}`)
                .join(", ")}`}
            />
          </Card>
        </StaggerItem>
      )}

      <MemberSheet member={selected} open={open} onClose={() => setOpen(false)} />
    </Stagger>
  );
}
