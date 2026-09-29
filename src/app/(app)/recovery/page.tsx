import { redirect } from "next/navigation";
import { db } from "@/db";
import { Dial } from "@/components/charts/Dial";
import { DeviationBar } from "@/components/dashboard/Bars";
import { CardHead, Chip, InfoGlyph, Notice } from "@/components/dashboard/bits";
import { DetailHeader } from "@/components/dashboard/DetailHeader";
import { TrendCard } from "@/components/dashboard/TrendCard";
import { AmbientGlow } from "@/components/ui/AmbientGlow";
import { Card } from "@/components/ui/Card";
import { Stagger, StaggerItem } from "@/components/ui/Stagger";
import { dateHref, dateLabel } from "@/lib/dashboard/dates";
import {
  BAND_COPY,
  calibrationProgress,
  limitedExplainer,
  recoveryNullReason,
  unsupportedNote,
} from "@/lib/dashboard/explain";
import { deviceName } from "@/lib/dashboard/format";
import { loadDashboardDay } from "@/lib/dashboard/load";
import { buildTrendSeries, recentAverage } from "@/lib/dashboard/trend";
import { getTrend } from "@/lib/scores/queries";
import { RECOVERY_KEYS, type RecoveryKey } from "@/lib/scores/recovery";
import { requireOnboardedUser } from "@/lib/session";
import { NEUTRAL_SIGNAL, recoveryColor, SIGNAL } from "@/lib/ui/colors";
import { formatNumber } from "@/lib/ui/format";

export const metadata = { title: "Recovery" };

const INPUT: Record<RecoveryKey, { label: string; unit: string; decimals: number }> = {
  rhr: { label: "Resting heart rate", unit: "bpm", decimals: 0 },
  hrv: { label: "Heart rate variability", unit: "ms", decimals: 0 },
  resp: { label: "Respiratory rate", unit: "rpm", decimals: 1 },
  sleep: { label: "Sleep performance", unit: "%", decimals: 0 },
};

/** "+3", "−0.4", "±0" at display precision. */
function signed(v: number, decimals: number): string {
  const text = formatNumber(Math.abs(v), decimals);
  if (Number(text) === 0) return `±${text}`;
  return `${v > 0 ? "+" : "−"}${text}`;
}

export default async function RecoveryPage({ searchParams }: PageProps<"/recovery">) {
  const user = await requireOnboardedUser();
  const { ctx, date, overview } = await loadDashboardDay(user, (await searchParams).date);
  if (!ctx.everSynced) redirect("/home");
  const trend = await getTrend(db, user.id, "recovery", "6m", date);

  const isToday = date === ctx.today;
  const comp = overview.scores?.components ?? null;
  const rec = comp?.recovery ?? null;
  const value = overview.scores?.recovery ?? null;
  const color = value !== null ? recoveryColor(value) : NEUTRAL_SIGNAL;
  const device = deviceName(overview.sleep?.night.chosenSource);
  const calibration = calibrationProgress(rec);
  const reason = recoveryNullReason(rec, { isToday, facts: ctx.facts, sleep: comp?.sleep ?? null });
  const limited = limitedExplainer(rec, ctx.facts, device);
  const unsupported = unsupportedNote(rec, device);
  const prev = overview.previous?.recovery ?? null;
  const delta = value !== null && prev !== null ? value - prev : null;

  const contributors = [...(rec?.contributors ?? [])].sort((a, b) => b.weight - a.weight);
  // Inputs the user's devices could give but didn't count today (never-sent inputs are explained in the notice).
  const missing = RECOVERY_KEYS.filter(
    (k) =>
      !contributors.some((c) => c.key === k) &&
      (k === "sleep" || (k === "hrv" ? ctx.facts.hasHrv : k === "resp" ? ctx.facts.hasResp : ctx.facts.hasRhr)),
  );

  let hero;
  if (calibration) {
    hero = (
      <Dial
        size="lg"
        value={calibration.done}
        max={calibration.needed}
        color={NEUTRAL_SIGNAL}
        label="Calibrating"
        display={`${calibration.done}/${calibration.needed}`}
        sublabel={`${calibration.done} OF ${calibration.needed} DAYS`}
      />
    );
  } else if (value === null) {
    hero = <Dial size="lg" value={0} max={100} color={NEUTRAL_SIGNAL} label="Recovery" display="—" hollow sublabel={reason ?? "NO DATA"} />;
  } else {
    hero = (
      <Dial
        size="lg"
        value={value}
        max={100}
        color={color}
        format="percent"
        label="Recovery"
        sublabel={delta !== null ? `${delta > 0 ? "▲" : delta < 0 ? "▼" : "–"} ${Math.abs(delta)} VS PREV DAY` : undefined}
        delay={0.1}
      />
    );
  }

  const nullCopy =
    reason === "NEEDS A TRACKER"
      ? "Recovery is built from resting heart rate and sleep, which an iPhone alone can't measure. Wear an Apple Watch or another tracker that writes to Apple Health, day and night."
      : reason === "SYNC TO SEE"
        ? "This morning's resting heart rate and last night's sleep haven't synced yet. Run a sync to see today's recovery."
        : "No resting heart rate or sleep was recorded for this day, so there's nothing to score.";

  return (
    <div className="relative isolate min-h-full">
      <AmbientGlow color={color} intensity={value !== null ? 1.1 : 0.6} />
      <DetailHeader title="Recovery" dateLabel={dateLabel(date, ctx.today)} backHref={dateHref("/home", date, ctx.today)} />

      <section aria-label="Recovery score" className="flex flex-col items-center px-4 pb-6 pt-6">
        {hero}
        {value !== null && rec?.band && (
          <div className="mt-6 text-center">
            <p className="flex items-center justify-center gap-2">
              <span className="font-display text-[22px] font-bold uppercase tracking-[0.06em]" style={{ color }}>
                {BAND_COPY[rec.band].title}
              </span>
              {rec.limited && <Chip>LIMITED DATA</Chip>}
            </p>
            <p className="mx-auto mt-1 max-w-[34ch] text-balance text-[15px] leading-snug text-muted">{BAND_COPY[rec.band].body}</p>
          </div>
        )}
      </section>

      <Stagger delay={0.35} className="space-y-3 px-4">
        {calibration && (
          <StaggerItem>
            <Notice title="Building your baseline" color={SIGNAL.strain}>
              Recovery compares each morning with your own 30-day normal. It needs {calibration.needed} days of resting
              heart rate or sleep before the first score: {calibration.needed - calibration.done} more to go.
            </Notice>
          </StaggerItem>
        )}
        {!calibration && value === null && (
          <StaggerItem>
            <Notice title={reason === "NEEDS A TRACKER" ? "Needs a tracker" : "No score"}>{nullCopy}</Notice>
          </StaggerItem>
        )}
        {limited && (
          <StaggerItem>
            <Notice title="Limited data" color={SIGNAL.yellow}>
              {limited}
            </Notice>
          </StaggerItem>
        )}

        {contributors.length > 0 && (
          <StaggerItem>
            <Card>
              <CardHead title="Contributors" meta="vs your 30-day normal" />
              <ul className="divide-y divide-hairline">
                {contributors.map((c, i) => {
                  const meta = INPUT[c.key];
                  const good = c.direction === "higher" ? c.z >= 0 : c.z <= 0;
                  const diff = c.value - c.baseline;
                  const tone = Math.abs(c.z) < 0.15 ? "var(--muted)" : good ? SIGNAL.green : SIGNAL.red;
                  return (
                    <li key={c.key} className="py-4 first:pt-0 last:pb-1">
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="min-w-0 truncate text-[15px] font-medium">{meta.label}</p>
                        <p className="flex shrink-0 items-baseline gap-1">
                          <span className="num font-display text-[26px] font-semibold leading-none">
                            {formatNumber(c.value, meta.decimals)}
                          </span>
                          <span className="telemetry w-7">{meta.unit}</span>
                        </p>
                      </div>
                      <div className="mt-2.5">
                        <DeviationBar z={c.z} good={good} delay={0.45 + i * 0.08} />
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-3">
                        <p className="telemetry">
                          30D <span className="text-text-2">{formatNumber(c.baseline, meta.decimals)}</span>
                          <span className="ml-2" style={{ color: tone }}>
                            {signed(diff, meta.decimals)}
                          </span>
                        </p>
                        <p className="telemetry">
                          Weight <span className="text-text-2">{Math.round(c.weight * 100)}%</span>
                        </p>
                      </div>
                    </li>
                  );
                })}
                {missing.map((k) => (
                  <li key={k} className="flex items-center justify-between gap-3 py-4 last:pb-1">
                    <p className="text-[15px] font-medium text-muted">{INPUT[k].label}</p>
                    <p className="telemetry text-dim">
                      {rec?.expected.includes(k) ? "No reading" : "Calibrating"}
                    </p>
                  </li>
                ))}
              </ul>
              {unsupported && (
                <p className="mt-3 flex items-start gap-2 border-t border-hairline pt-3 text-[13px] leading-snug text-muted">
                  <InfoGlyph className="mt-[2px] shrink-0" />
                  <span>{unsupported}</span>
                </p>
              )}
            </Card>
          </StaggerItem>
        )}

        <StaggerItem>
          <TrendCard
            metrics={[
              {
                key: "recovery",
                label: "Recovery",
                series: buildTrendSeries(trend, recoveryColor),
                avg: recentAverage(trend),
                format: "percent",
                max: 100,
                color: SIGNAL.green,
              },
            ]}
          />
        </StaggerItem>

        <StaggerItem>
          <p className="telemetry flex items-center justify-center gap-3 px-2 pb-2 pt-1 text-[9.5px] text-dim">
            {(["green", "yellow", "red"] as const).map((b) => (
              <span key={b} className="flex items-center gap-1.5">
                <span className="size-[5px] rounded-full" style={{ background: SIGNAL[b] }} />
                {b === "green" ? "67–99" : b === "yellow" ? "34–66" : "1–33"}
              </span>
            ))}
          </p>
        </StaggerItem>
      </Stagger>
    </div>
  );
}
