import { redirect } from "next/navigation";
import { db } from "@/db";
import { Dial } from "@/components/charts/Dial";
import { HourBars } from "@/components/charts/HourBars";
import { Meter } from "@/components/dashboard/Bars";
import { CardHead, Figure, LiveBadge, Notice } from "@/components/dashboard/bits";
import { DetailHeader } from "@/components/dashboard/DetailHeader";
import { TrendCard } from "@/components/dashboard/TrendCard";
import { AmbientGlow } from "@/components/ui/AmbientGlow";
import { Card } from "@/components/ui/Card";
import { Stagger, StaggerItem } from "@/components/ui/Stagger";
import { currentHourFor, dateHref, dateLabel } from "@/lib/dashboard/dates";
import { strainNullReason } from "@/lib/dashboard/explain";
import { formatDuration, formatInt } from "@/lib/dashboard/format";
import { loadDashboardDay } from "@/lib/dashboard/load";
import { hourPoints } from "@/lib/dashboard/overview-view";
import { buildTrendSeries, recentAverage } from "@/lib/dashboard/trend";
import { getTrend } from "@/lib/scores/queries";
import { ZONE_BOUNDS } from "@/lib/scores/strain";
import { requireOnboardedUser } from "@/lib/session";
import { NEUTRAL_SIGNAL, SIGNAL, STRAIN_MAX, ZONE_COLORS } from "@/lib/ui/colors";
import { formatNumber } from "@/lib/ui/format";

export const metadata = { title: "Strain" };

const DEFAULT_STEP_GOAL = 10_000;

/** WHOOP-style effort bands on the 0-21 scale. */
function level(strain: number): string {
  if (strain >= 18) return "ALL OUT";
  if (strain >= 14) return "STRENUOUS";
  if (strain >= 10) return "MODERATE";
  return "LIGHT";
}

const SOURCE_LABEL = {
  profile: "from your profile",
  age: "estimated from age",
  default: "default",
  day: "today's reading",
  baseline: "30-day average",
} as const;

export default async function StrainPage({ searchParams }: PageProps<"/strain">) {
  const user = await requireOnboardedUser();
  const { ctx, date, overview } = await loadDashboardDay(user, (await searchParams).date);
  if (!ctx.everSynced) redirect("/home");
  const trend = await getTrend(db, user.id, "strain", "6m", date);

  const isToday = date === ctx.today;
  const res = overview.scores?.components?.strain ?? null;
  const strain = overview.scores?.strain ?? null;
  const hours = hourPoints(overview.hrHourly);
  const present = hours.filter((h) => h !== null);
  const avgHr = present.length ? Math.round(present.reduce((a, h) => a + h!.avg, 0) / present.length) : null;
  const maxHr = present.length ? Math.max(...present.map((h) => h!.max)) : null;
  const zones = res ? [res.zones.z1, res.zones.z2, res.zones.z3, res.zones.z4, res.zones.z5] : [0, 0, 0, 0, 0];
  const zoneMax = Math.max(...zones, 1);
  const zoneTotal = zones.reduce((a, b) => a + b, 0);
  const { steps, activeKcal, exerciseMin } = overview.activity;
  const stepGoal = user.stepGoal ?? DEFAULT_STEP_GOAL;
  const c = res?.components;
  const zoneBpm = (i: number) => {
    if (!c) return null;
    const bpm = (p: number) => Math.round(c.rhr + p * (c.maxHr - c.rhr));
    return i === 4 ? `${bpm(ZONE_BOUNDS[4])}+` : `${bpm(ZONE_BOUNDS[i])}–${bpm(ZONE_BOUNDS[i + 1]) - 1}`;
  };

  return (
    <div className="relative isolate min-h-full">
      <AmbientGlow color={strain !== null ? SIGNAL.strain : NEUTRAL_SIGNAL} intensity={strain !== null ? 1 : 0.6} />
      <DetailHeader title="Strain" dateLabel={dateLabel(date, ctx.today)} backHref={dateHref("/home", date, ctx.today)} />

      <section aria-label="Strain score" className="flex flex-col items-center px-4 pb-6 pt-6">
        {strain !== null ? (
          <Dial
            size="lg"
            value={strain}
            max={STRAIN_MAX}
            color={SIGNAL.strain}
            format="decimal"
            label="Strain"
            sublabel={isToday ? "SO FAR TODAY" : level(strain)}
            delay={0.1}
          />
        ) : (
          <Dial
            size="lg"
            value={0}
            max={STRAIN_MAX}
            color={NEUTRAL_SIGNAL}
            label="Strain"
            display="—"
            hollow
            sublabel={strainNullReason(res, { isToday }) ?? "NO DATA"}
          />
        )}
        {strain !== null && (
          <div className="mt-5 flex items-center gap-3">
            {isToday && <LiveBadge label="LIVE · UPDATES AS YOU SYNC" />}
            {!isToday && (
              <p className="telemetry">
                <span className="text-text-2">{level(strain)}</span> · 0–{STRAIN_MAX} SCALE
              </p>
            )}
          </div>
        )}
      </section>

      <Stagger delay={0.35} className="space-y-3 px-4">
        <StaggerItem>
          <Card glow={SIGNAL.strain}>
            <CardHead
              title="Heart rate by hour"
              meta={
                avgHr !== null ? (
                  <span>
                    AVG <span className="text-text-2">{avgHr}</span> · MAX <span className="text-text-2">{maxHr}</span> BPM
                  </span>
                ) : undefined
              }
            />
            {present.length ? (
              <HourBars
                data={hours}
                height={160}
                nowHour={currentHourFor(date, ctx.today, ctx.tz, ctx.now)}
                h12={ctx.h12}
                ariaLabel={`Heart rate by hour. Average ${avgHr}, max ${maxHr} beats per minute.`}
                delay={0.4}
              />
            ) : (
              <Notice>
                No heart-rate data for this day{c?.basis === "activity" ? ", so strain is estimated from steps and active calories" : ""}.
              </Notice>
            )}
          </Card>
        </StaggerItem>

        {present.length > 0 && (
          <StaggerItem>
            <Card>
              <CardHead title="Heart-rate zones" meta={<span><span className="text-text-2">{formatDuration(zoneTotal)}</span> in zones</span>} />
              <ul className="space-y-3">
                {[4, 3, 2, 1, 0].map((i) => (
                  <li key={i} className="grid grid-cols-[76px_1fr_52px] items-center gap-3">
                    <div>
                      <p className="flex items-center gap-2 text-[14px] font-medium">
                        <span className="size-2 rounded-[3px]" style={{ background: ZONE_COLORS[i] }} />
                        Zone {i + 1}
                      </p>
                      <p className="telemetry mt-0.5 pl-4 text-[9.5px]">{zoneBpm(i)}</p>
                    </div>
                    <Meter value={zones[i] / zoneMax} color={ZONE_COLORS[i]} height={8} delay={0.45 + (4 - i) * 0.06} />
                    <span className={`num text-right font-mono text-[12px] ${zones[i] ? "text-text-2" : "text-dim"}`}>
                      {formatDuration(zones[i])}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="telemetry mt-4 text-[9.5px] text-dim">Zones are % of heart-rate reserve, estimated per hour.</p>
            </Card>
          </StaggerItem>
        )}

        <StaggerItem>
          <Card>
            <CardHead title={isToday ? "Activity so far" : "Activity"} />
            <div className="flex items-center gap-5">
              <Dial
                size={104}
                value={steps ?? 0}
                max={stepGoal}
                color={SIGNAL.strain}
                label="Steps"
                hideLabel
                display={steps !== null ? `${Math.min(999, Math.round((steps / stepGoal) * 100))}%` : "—"}
                hollow={steps === null}
                ariaLabel={steps !== null ? `Steps: ${formatInt(steps)} of ${formatInt(stepGoal)} goal` : "Steps: no data"}
                delay={0.5}
                className="shrink-0"
              />
              <div className="grid min-w-0 flex-1 grid-cols-1 gap-3.5">
                <Figure label={`Steps · goal ${formatInt(stepGoal)}`} value={steps !== null ? formatInt(steps) : "—"} size={26} />
                <div className="grid grid-cols-2 gap-3">
                  <Figure label="Active cal" value={activeKcal !== null ? formatInt(activeKcal) : "—"} size={22} />
                  {exerciseMin === null && maxHr !== null ? (
                    <Figure label="Peak HR" value={maxHr} unit="bpm" size={22} />
                  ) : (
                    <Figure
                      label="Exercise"
                      value={exerciseMin !== null ? Math.round(exerciseMin) : "—"}
                      unit={exerciseMin !== null ? "min" : undefined}
                      size={22}
                    />
                  )}
                </div>
              </div>
            </div>
          </Card>
        </StaggerItem>

        {c && strain !== null && (
          <StaggerItem>
            <Card>
              <CardHead title="How it's calculated" />
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 font-mono text-[12px]">
                <dt className="telemetry">Max HR</dt>
                <dd className="text-right text-text-2">
                  {c.maxHr} bpm <span className="text-dim">· {SOURCE_LABEL[c.maxHrSource]}</span>
                </dd>
                <dt className="telemetry">Resting HR</dt>
                <dd className="text-right text-text-2">
                  {formatNumber(c.rhr, 0)} bpm <span className="text-dim">· {SOURCE_LABEL[c.rhrSource]}</span>
                </dd>
                <dt className="telemetry">HR hours</dt>
                <dd className="text-right text-text-2">{c.hoursWithHr} of 24</dd>
                {c.basis === "hr" ? (
                  <>
                    <dt className="telemetry">Cardio load</dt>
                    <dd className="text-right text-text-2">{formatNumber(c.cardioLoad, 0)}</dd>
                    <dt className="telemetry">Activity load</dt>
                    <dd className="text-right text-text-2">
                      {formatNumber(c.activityLoad, 0)} <span className="text-dim">× 0.35</span>
                    </dd>
                  </>
                ) : (
                  <>
                    <dt className="telemetry">Basis</dt>
                    <dd className="text-right text-text-2">steps + active calories</dd>
                  </>
                )}
                <dt className="telemetry text-text-2">Total load</dt>
                <dd className="text-right text-text">
                  {formatNumber(c.load, 0)} <span className="text-dim">→ {formatNumber(strain, 1)} / {STRAIN_MAX}</span>
                </dd>
              </dl>
            </Card>
          </StaggerItem>
        )}

        <StaggerItem>
          <TrendCard
            metrics={[
              {
                key: "strain",
                label: "Strain",
                series: buildTrendSeries(trend),
                avg: recentAverage(trend),
                format: "decimal",
                max: STRAIN_MAX,
                color: SIGNAL.strain,
              },
            ]}
          />
        </StaggerItem>
      </Stagger>
    </div>
  );
}
