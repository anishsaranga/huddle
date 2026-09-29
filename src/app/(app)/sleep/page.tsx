import { redirect } from "next/navigation";
import { db } from "@/db";
import { Dial } from "@/components/charts/Dial";
import { SleepTimeline } from "@/components/charts/SleepTimeline";
import { Meter } from "@/components/dashboard/Bars";
import { CardHead, Notice } from "@/components/dashboard/bits";
import { DetailHeader } from "@/components/dashboard/DetailHeader";
import { BedtimeChart, SleepStages } from "@/components/dashboard/SleepCharts";
import { TrendCard } from "@/components/dashboard/TrendCard";
import { AmbientGlow } from "@/components/ui/AmbientGlow";
import { Card } from "@/components/ui/Card";
import { Stagger, StaggerItem } from "@/components/ui/Stagger";
import { dateHref, dateLabel } from "@/lib/dashboard/dates";
import { SLEEP_COMPONENT_LABEL, sleepComponentMissingWhy, sleepNullReason } from "@/lib/dashboard/explain";
import { deviceName, formatClockMinutes, formatHm } from "@/lib/dashboard/format";
import { loadDashboardDay } from "@/lib/dashboard/load";
import { sleepCardView } from "@/lib/dashboard/overview-view";
import { bedtimeChart, stageBreakdown } from "@/lib/dashboard/sleep-view";
import { buildTrendSeries, recentAverage } from "@/lib/dashboard/trend";
import { getRecentNights, getTrend } from "@/lib/scores/queries";
import { DEFAULT_SLEEP_NEED_MIN, SLEEP_WEIGHTS, type SleepComponentKey } from "@/lib/scores/sleep";
import { requireOnboardedUser } from "@/lib/session";
import { NEUTRAL_SIGNAL, SIGNAL } from "@/lib/ui/colors";

export const metadata = { title: "Sleep" };

const COMPONENT_ORDER = Object.keys(SLEEP_WEIGHTS) as SleepComponentKey[];

export default async function SleepPage({ searchParams }: PageProps<"/sleep">) {
  const user = await requireOnboardedUser();
  const { ctx, date, overview } = await loadDashboardDay(user, (await searchParams).date);
  if (!ctx.everSynced) redirect("/home");
  const [scoreTrend, hoursTrend, nights] = await Promise.all([
    getTrend(db, user.id, "sleep", "6m", date),
    getTrend(db, user.id, "sleep_duration", "6m", date),
    getRecentNights(db, user.id, date, 7),
  ]);

  const isToday = date === ctx.today;
  const sleep = overview.scores?.components?.sleep ?? null;
  const score = overview.scores?.sleep ?? null;
  const night = overview.sleep?.night ?? null;
  const card = sleepCardView(overview, ctx, isToday);
  const device = deviceName(night?.chosenSource);
  const needMin = sleep?.needMin ?? user.sleepGoalMin ?? DEFAULT_SLEEP_NEED_MIN;
  const asleepMin = night?.asleepMin && night.asleepMin > 0 ? night.asleepMin : null;
  const chart = bedtimeChart(nights, date, ctx.tz, ctx.h12);

  const detail = (k: SleepComponentKey): string | null => {
    if (!sleep || sleep.components[k] === null) return null;
    switch (k) {
      case "duration":
        return asleepMin !== null ? `${formatHm(asleepMin)} of ${formatHm(needMin)}` : null;
      case "efficiency":
        return sleep.efficiency !== null ? `${Math.round(sleep.efficiency * 100)}% of time in bed asleep` : null;
      case "restorative":
        return sleep.restorativeShare !== null ? `${Math.round(sleep.restorativeShare * 100)}% deep + REM` : null;
      case "consistency":
        return sleep.consistencyDevMin !== null ? `±${Math.round(sleep.consistencyDevMin)} min vs your usual times` : null;
    }
  };

  return (
    <div className="relative isolate min-h-full">
      <AmbientGlow color={score !== null ? SIGNAL.sleep : NEUTRAL_SIGNAL} intensity={score !== null ? 1 : 0.6} />
      <DetailHeader title="Sleep" dateLabel={dateLabel(date, ctx.today)} backHref={dateHref("/home", date, ctx.today)} />

      <section aria-label="Sleep score" className="flex flex-col items-center px-4 pb-6 pt-6">
        {score !== null ? (
          <Dial
            size="lg"
            value={score}
            max={100}
            color={SIGNAL.sleep}
            format="percent"
            label="Sleep"
            sublabel={asleepMin !== null ? `${formatHm(asleepMin)} ASLEEP` : undefined}
            delay={0.1}
          />
        ) : (
          <Dial
            size="lg"
            value={0}
            max={100}
            color={NEUTRAL_SIGNAL}
            label="Sleep"
            display="—"
            hollow
            sublabel={sleepNullReason(sleep, { isToday }) ?? "NO SLEEP DATA"}
          />
        )}
      </section>

      <Stagger delay={0.35} className="space-y-3 px-4">
        {asleepMin !== null && (
          <StaggerItem>
            <Card glow={SIGNAL.sleep}>
              <CardHead title="Hours vs need" meta={card.kind !== "none" && "bed" in card ? `${card.bed} → ${card.wake}` : undefined} />
              <div className="mb-4 flex items-end justify-between gap-3">
                <p className="flex items-baseline gap-2">
                  <span className="num font-display text-[44px] font-semibold leading-[0.8]">{formatHm(asleepMin)}</span>
                  <span className="telemetry">of {formatHm(needMin)} need</span>
                </p>
                <span className="num font-display text-[22px] font-semibold leading-none" style={{ color: SIGNAL.sleep }}>
                  {Math.round((asleepMin / needMin) * 100)}%
                </span>
              </div>
              <Meter value={asleepMin / Math.max(needMin, asleepMin)} mark={asleepMin > needMin ? needMin / asleepMin : undefined} color={SIGNAL.sleep} delay={0.4} />
            </Card>
          </StaggerItem>
        )}

        <StaggerItem>
          <Card>
            <CardHead title="Stages" meta={night ? <>via <span className="text-text-2">{night.chosenSource}</span></> : undefined} />
            {card.kind === "stages" && night ? (
              <SleepStages
                segments={card.segments}
                rows={stageBreakdown(night)}
                startLabel={card.bed}
                endLabel={card.wake}
                ariaLabel={`Sleep stages from ${card.bed} to ${card.wake}, ${card.asleep} asleep.`}
              />
            ) : card.kind === "timeline" ? (
              <>
                <SleepTimeline
                  blocks={card.blocks}
                  startLabel={card.bed}
                  endLabel={card.wake}
                  ariaLabel={`Asleep and awake periods from ${card.bed} to ${card.wake}, ${card.asleep} asleep.`}
                  delay={0.25}
                />
                <p className="mt-4 text-[14px] leading-snug text-muted">
                  Stages not available from {card.device}: it only tells Apple Health when you were asleep or awake.
                </p>
              </>
            ) : card.kind === "in_bed" ? (
              <Notice color={SIGNAL.sleep} title="Time in bed only">
                Only time in bed ({card.inBed}, {card.bed} → {card.wake}) was recorded by{" "}
                {card.device === "iPhone" ? "your iPhone" : card.device}. Wear a tracker to bed for sleep scores.
              </Notice>
            ) : (
              <p className="text-[14px] leading-snug text-muted">{card.kind === "none" ? card.message : null}</p>
            )}
          </Card>
        </StaggerItem>

        {sleep && sleep.score !== null && (
          <StaggerItem>
            <Card>
              <CardHead title="Score breakdown" meta="weight" />
              <ul className="space-y-5">
                {COMPONENT_ORDER.map((k, i) => {
                  const v = sleep.components[k];
                  const why = sleepComponentMissingWhy(k, sleep, { device, hasStages: !!night?.hasStages });
                  return (
                    <li key={k}>
                      <div className="flex items-baseline justify-between gap-3">
                        <p className={`text-[15px] font-medium ${v === null ? "text-muted" : ""}`}>{SLEEP_COMPONENT_LABEL[k]}</p>
                        <p className="telemetry">{v === null ? "—" : `${Math.round(sleep.weights[k] * 100)}%`}</p>
                      </div>
                      {v !== null ? (
                        <>
                          <div className="mt-2 flex items-center gap-3">
                            <div className="flex-1">
                              <Meter value={v / 100} color={SIGNAL.sleep} delay={0.45 + i * 0.07} />
                            </div>
                            <span className="num w-8 text-right font-display text-[20px] font-semibold leading-none">{Math.round(v)}</span>
                          </div>
                          <p className="telemetry mt-1.5">{detail(k)}</p>
                        </>
                      ) : (
                        <p className="mt-1 text-[13px] leading-snug text-dim">Not available · {why}</p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Card>
          </StaggerItem>
        )}

        {chart.rows.some((r) => r.bed !== null) && (
          <StaggerItem>
            <Card>
              <CardHead
                title="Bedtime consistency"
                meta={
                  chart.meanBed !== null && chart.meanWake !== null ? (
                    <>
                      avg <span className="text-text-2">{formatClockMinutes(18 * 60 + chart.meanBed, ctx.h12)}</span> →{" "}
                      <span className="text-text-2">{formatClockMinutes(18 * 60 + chart.meanWake, ctx.h12)}</span>
                    </>
                  ) : undefined
                }
              />
              <BedtimeChart
                data={chart}
                ariaLabel={`Bed and wake times, last 7 nights. ${chart.rows
                  .filter((r) => r.bedLabel)
                  .map((r) => `${r.label}: ${r.bedLabel} to ${r.wakeLabel}`)
                  .join("; ")}.`}
              />
            </Card>
          </StaggerItem>
        )}

        <StaggerItem>
          <TrendCard
            metrics={[
              {
                key: "score",
                label: "Score",
                series: buildTrendSeries(scoreTrend),
                avg: recentAverage(scoreTrend),
                format: "percent",
                max: 100,
                color: SIGNAL.sleep,
              },
              {
                key: "hours",
                label: "Hours",
                series: buildTrendSeries(hoursTrend),
                avg: recentAverage(hoursTrend),
                format: "hm",
                max: Math.max(600, needMin + 60),
                color: SIGNAL.sleep,
              },
            ]}
          />
        </StaggerItem>
      </Stagger>
    </div>
  );
}
