"use client";

import { Dial } from "@/components/charts/Dial";
import { AvatarStack, type AvatarUser } from "@/components/ui/Avatar";
import { Card } from "@/components/ui/Card";
import type { GroupToday } from "@/lib/groups/view";
import type { ScoreMetric } from "@/lib/scores/queries";
import { alpha, recoveryColorOrNeutral, SIGNAL } from "@/lib/ui/colors";
import { formatNumber } from "@/lib/ui/format";
import { METRIC, metricColor, metricDecimals } from "./metric";

type GroupCardProps = {
  id: string;
  name: string;
  timezone: string;
  memberCount: number;
  people: { id: string; label: string; user: AvatarUser }[];
  today: GroupToday;
  /** Entrance delay for the dials, seconds. */
  delay?: number;
};

const ORDER: ScoreMetric[] = ["recovery", "strain", "sleep"];
const SHORT: Record<ScoreMetric, string> = { recovery: "REC", strain: "STRAIN", sleep: "SLEEP" };

/** A group on the Community list: name, people, today's group dials and sync count. Taps into the group. */
export function GroupCard({ id, name, timezone, memberCount, people, today, delay = 0 }: GroupCardProps) {
  return (
    <Card
      variant="interactive"
      href={`/groups/${id}`}
      glow={recoveryColorOrNeutral(today.recovery.value)}
      ariaLabel={`${name}, ${memberCount} members, ${today.synced} of ${today.total} synced today`}
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="min-w-0 truncate font-display text-[30px] font-bold uppercase leading-[0.95] tracking-[0.03em]">{name}</h2>
        <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="mt-1.5 shrink-0 text-dim">
          <path d="m6 3.5 4.5 4.5L6 12.5" />
        </svg>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <AvatarStack people={people.slice(0, 4)} total={memberCount} size="sm" />
        <div className="telemetry min-w-0 leading-[1.45]">
          <p className="truncate">
            <span className="text-text-2">{memberCount}</span> {memberCount === 1 ? "MEMBER" : "MEMBERS"}
          </p>
          <p className="truncate">{timezone}</p>
        </div>
      </div>

      <div className="mt-5 flex items-end justify-between gap-2 border-t border-hairline pt-4">
        <div className="flex gap-3">
          {ORDER.map((m, i) => {
            const a = today[m];
            const hollow = a.value === null;
            return (
              <div key={m} className="flex flex-col items-center gap-1.5">
                <Dial
                  size="sm"
                  value={a.value ?? 0}
                  max={METRIC[m].max}
                  color={metricColor(m, a.value)}
                  label={METRIC[m].label}
                  format={m === "strain" ? "decimal" : "integer"}
                  display={hollow ? "—" : undefined}
                  hollow={hollow}
                  delay={delay + i * 0.08}
                  ariaLabel={`Group ${METRIC[m].noun} today: ${hollow ? "no data" : `${formatNumber(a.value!, metricDecimals(m))}${METRIC[m].unit}`}`}
                />
                <span className="telemetry text-[8.5px]">{SHORT[m]}</span>
              </div>
            );
          })}
        </div>
        <div className="min-w-0 pb-0.5 text-right">
          <p className="num font-display text-[28px] font-semibold leading-none">
            {today.synced}
            <span className="text-[16px] text-muted"> / {today.total}</span>
          </p>
          <p className="telemetry mt-1.5 text-[9px]">SYNCED TODAY</p>
          <div className="mt-2 flex justify-end gap-[3px]" aria-hidden>
            {Array.from({ length: Math.min(today.total, 12) }, (_, i) => (
              <span
                key={i}
                className="h-[3px] w-[9px] rounded-full"
                style={{
                  background: i < today.synced ? SIGNAL.green : "var(--track)",
                  boxShadow: i < today.synced ? `0 0 6px ${alpha(SIGNAL.green, 50)}` : undefined,
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}
