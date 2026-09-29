"use client";

import { useState, type ReactNode } from "react";
import { Dial } from "@/components/charts/Dial";
import { HourBars } from "@/components/charts/HourBars";
import { Hypnogram } from "@/components/charts/Hypnogram";
import { Sparkline } from "@/components/charts/Sparkline";
import { TrendBars } from "@/components/charts/TrendBars";
import { AmbientGlow } from "@/components/ui/AmbientGlow";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { CountUp } from "@/components/ui/CountUp";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Sheet } from "@/components/ui/Sheet";
import { Skeleton } from "@/components/ui/Skeleton";
import { Stagger, StaggerItem } from "@/components/ui/Stagger";
import { StatRow } from "@/components/ui/StatRow";
import { useToast } from "@/components/ui/Toast";
import { TopTabs } from "@/components/ui/TopTabs";
import {
  hrvTrend,
  overviewDays,
  recoveryTrend,
  strainTrend,
  trendLabels,
} from "@/lib/mock/overview";
import { recoveryColor, SIGNAL, STAGE_COLORS, STAGE_LABELS, STAGE_ORDER, STRAIN_MAX } from "@/lib/ui/colors";

type Band = "green" | "yellow" | "red";
const BAND_VALUE: Record<Band, number> = { green: 82, yellow: 51, red: 19 };

const today = overviewDays[0];

const leaderboard = [
  { name: "Maya", value: 91 },
  { name: "You", value: 78, me: true },
  { name: "Theo", value: 57 },
  { name: "Jonas", value: 33 },
  { name: "Priya", value: 12 },
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <StaggerItem as="section" className="space-y-3">
      <h2 className="telemetry px-1 text-text-2">{`// ${title}`}</h2>
      {children}
    </StaggerItem>
  );
}

function LeaderRow({
  rank,
  name,
  value,
  me,
}: {
  rank: number;
  name: string;
  value: number;
  me?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-3 px-4 py-2.5 ${me ? "bg-white/[0.04]" : ""}`}
    >
      <span className="telemetry w-4 text-right">{rank}</span>
      <span
        aria-hidden
        className="grid size-9 place-items-center rounded-full bg-card-elevated font-display text-[15px] font-semibold"
        style={{ boxShadow: `0 0 0 2px ${recoveryColor(value)}` }}
      >
        {name[0]}
      </span>
      <span className="flex-1 text-[15px] font-medium">{name}</span>
      <Dial size="sm" value={value} max={100} format="percent" color={recoveryColor(value)} label={`${name} recovery`} delay={rank * 0.06} />
    </div>
  );
}

export function Showcase() {
  const [band, setBand] = useState<Band>("green");
  const [range, setRange] = useState<"1w" | "1m" | "6m">("1w");
  const [period, setPeriod] = useState<"day" | "week">("day");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [counter, setCounter] = useState(1284);
  const [replay, setReplay] = useState(0);
  const { toast } = useToast();

  const bandValue = BAND_VALUE[band];
  const bandColor = recoveryColor(bandValue);

  const recoveryBars = recoveryTrend.map((v, i) => ({
    label: trendLabels[i],
    value: v,
    color: recoveryColor(v),
  }));
  const strainBars = strainTrend.slice(-7).map((v, i) => ({ label: trendLabels[i + 7], value: v }));

  return (
    <div className="relative isolate min-h-dvh overflow-x-clip">
      <AmbientGlow color={bandColor} />
      <div
        key={replay}
        className="pt-safe px-safe mx-auto max-w-md pb-safe"
      >
        <header className="flex items-end justify-between px-5 pb-5 pt-8">
          <div>
            <p className="telemetry mb-2">Dev · design system</p>
            <h1 className="font-display text-[44px] font-bold uppercase leading-[0.9] tracking-[0.02em]">
              UI Kit
            </h1>
          </div>
          <Button variant="secondary" size="sm" onClick={() => setReplay((r) => r + 1)}>
            Replay
          </Button>
        </header>

        <Stagger delay={0.1} className="space-y-9 px-4 pb-24">
          <Section title="Ambient glow · recovery bands">
            <SegmentedControl
              ariaLabel="Recovery band"
              value={band}
              onChange={setBand}
              options={[
                { value: "green", label: "Green" },
                { value: "yellow", label: "Yellow" },
                { value: "red", label: "Red" },
              ]}
            />
            <div className="flex justify-center pt-4">
              <Dial
                size="lg"
                value={bandValue}
                max={100}
                format="percent"
                color={bandColor}
                label="Recovery"
                sublabel="HRV 71 MS · RHR 51"
                delay={0.2}
              />
            </div>
          </Section>

          <Section title="Dials · md">
            <div className="grid grid-cols-3">
              <Dial value={82} max={100} format="percent" color={recoveryColor(82)} label="Green" delay={0.1} />
              <Dial value={51} max={100} format="percent" color={recoveryColor(51)} label="Yellow" delay={0.22} />
              <Dial value={19} max={100} format="percent" color={recoveryColor(19)} label="Red" delay={0.34} />
            </div>
            <div className="grid grid-cols-3">
              <Dial value={today.strain} max={STRAIN_MAX} format="decimal" color={SIGNAL.strain} label="Strain" delay={0.46} />
              <Dial value={today.sleep} max={100} format="percent" color={SIGNAL.sleep} label="Sleep" delay={0.58} />
              <Dial value={0} max={100} format="percent" color={SIGNAL.green} label="No data" />
            </div>
          </Section>

          <Section title="Dials · sm (leaderboard)">
            <Card padding="py-2">
              <div className="divide-y divide-hairline">
                {leaderboard.map((p, i) => (
                  <LeaderRow key={p.name} rank={i + 1} {...p} />
                ))}
              </div>
            </Card>
          </Section>

          <Section title="Type">
            <Card>
              <p className="num font-display text-[64px] font-semibold leading-none">
                <CountUp value={counter} />
              </p>
              <p className="label mt-3">All-caps label</p>
              <p className="telemetry mt-2">Telemetry · 07:18:42 · 62 MS</p>
              <p className="mt-3 text-[15px] leading-relaxed text-muted">
                Body copy in Hanken Grotesk. Muted text stays at 4.5:1 or better on
                cards and background.
              </p>
              <div className="mt-4">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setCounter(Math.round(200 + Math.random() * 9800))}
                >
                  Count to random
                </Button>
              </div>
            </Card>
          </Section>

          <Section title="Cards">
            <Card>
              <p className="label">Default</p>
              <p className="mt-2 text-[15px] text-muted">Top-lit edge, inner shadow.</p>
            </Card>
            <Card variant="elevated">
              <p className="label">Elevated</p>
              <p className="mt-2 text-[15px] text-muted">Slightly lighter surface.</p>
            </Card>
            <Card variant="interactive" chevron onClick={() => toast({ title: "Card tapped" })}>
              <p className="label">Interactive</p>
              <p className="mt-2 text-[15px] text-muted">Press me: scale spring + chevron.</p>
            </Card>
            <Card glow={SIGNAL.strain}>
              <p className="label">Glow · strain</p>
              <p className="mt-2 text-[15px] text-muted">Signal-tinted top edge.</p>
            </Card>
          </Section>

          <Section title="Buttons">
            <div className="flex flex-wrap gap-2">
              <Button>Primary</Button>
              <Button variant="signal">Signal</Button>
              <Button variant="signal" color={SIGNAL.green}>
                Signal green
              </Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="ghost">Ghost</Button>
              <Button
                variant="primary"
                loading={loading}
                onClick={() => {
                  setLoading(true);
                  window.setTimeout(() => setLoading(false), 1500);
                }}
              >
                {loading ? "Saving" : "Loading state"}
              </Button>
              <Button variant="secondary" disabled>
                Disabled
              </Button>
            </div>
            <Button size="lg" fullWidth>
              Full width · lg
            </Button>
          </Section>

          <Section title="Segmented control">
            <SegmentedControl
              ariaLabel="Period"
              value={period}
              onChange={setPeriod}
              options={[
                { value: "day", label: "Day" },
                { value: "week", label: "Week" },
              ]}
            />
            <SegmentedControl
              ariaLabel="Range"
              size="sm"
              value={range}
              onChange={setRange}
              options={[
                { value: "1w", label: "1W" },
                { value: "1m", label: "1M" },
                { value: "6m", label: "6M" },
              ]}
            />
          </Section>

          <Section title="Top tabs (swipe panels)">
            <Card padding="p-0" className="overflow-hidden">
              <TopTabs
                defaultIndex={2}
                tabs={[
                  {
                    id: "info",
                    label: "Info",
                    content: <p className="p-5 text-[15px] text-muted">Group info, members, invite link.</p>,
                  },
                  {
                    id: "chat",
                    label: "Chat",
                    content: <p className="p-5 text-[15px] text-muted">Chat bubbles go here.</p>,
                  },
                  {
                    id: "strain",
                    label: "Strain",
                    content: (
                      <div className="p-5">
                        <TrendBars data={strainBars} max={STRAIN_MAX} ariaLabel="Strain, last 7 days" showValues decimals={1} height={110} />
                      </div>
                    ),
                  },
                  {
                    id: "recovery",
                    label: "Recovery",
                    content: (
                      <div className="py-2">
                        {leaderboard.map((p, i) => (
                          <LeaderRow key={p.name} rank={i + 1} {...p} />
                        ))}
                      </div>
                    ),
                  },
                  {
                    id: "sleep",
                    label: "Sleep",
                    content: (
                      <div className="p-5">
                        <Sparkline data={hrvTrend} color={SIGNAL.sleep} ariaLabel="Sleep performance trend" />
                      </div>
                    ),
                  },
                ]}
              />
            </Card>
          </Section>

          <Section title="Sparkline">
            <Card>
              <div className="mb-3 flex items-baseline justify-between">
                <p className="label">HRV · 14 days</p>
                <p className="telemetry">
                  Last <span className="text-text-2">71 ms</span>
                </p>
              </div>
              <Sparkline data={hrvTrend} color={SIGNAL.green} ariaLabel="HRV, last 14 days, 41 to 71 ms" delay={0.2} />
            </Card>
          </Section>

          <Section title="Trend bars · recovery bands">
            <Card>
              <TrendBars
                data={recoveryBars}
                max={100}
                baseline={62}
                baselineLabel="30D 62%"
                ariaLabel="Recovery, last 14 days"
                delay={0.1}
              />
            </Card>
          </Section>

          <Section title="Hypnogram">
            <Card glow={SIGNAL.sleep}>
              <Hypnogram
                segments={today.sleepSegments}
                startLabel={today.bedtime}
                endLabel={today.wake}
                ariaLabel="Sleep stages last night"
                delay={0.1}
              />
              <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2">
                {STAGE_ORDER.map((s) => (
                  <span key={s} className="telemetry flex items-center gap-1.5">
                    <span aria-hidden className="size-2 rounded-[2px]" style={{ background: STAGE_COLORS[s] }} />
                    {STAGE_LABELS[s]}
                  </span>
                ))}
              </div>
            </Card>
          </Section>

          <Section title="Hour bars · HR by hour">
            <Card glow={SIGNAL.strain}>
              <HourBars data={today.hourly} ariaLabel="Heart rate by hour" delay={0.1} />
            </Card>
          </Section>

          <Section title="Stat rows">
            <Card padding="px-5 py-2">
              <div className="divide-y divide-hairline">
                {today.stats.slice(0, 4).map((s) => (
                  <StatRow key={s.id} {...s} />
                ))}
              </div>
            </Card>
          </Section>

          <Section title="Sheet · toast">
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={() => setSheetOpen(true)}>
                Open sheet
              </Button>
              <Button
                variant="secondary"
                onClick={() => toast({ title: "Synced", description: "3 days imported.", tone: "success" })}
              >
                Toast ✓
              </Button>
              <Button
                variant="secondary"
                onClick={() => toast({ title: "Heads up", description: "Shortcut hasn't run today.", tone: "warning" })}
              >
                Toast !
              </Button>
              <Button
                variant="secondary"
                onClick={() => toast({ title: "Sync failed", description: "Didn't hear from your Shortcut.", tone: "error" })}
              >
                Toast ✕
              </Button>
            </div>
          </Section>

          <Section title="Skeleton">
            <Card>
              <div className="flex items-center gap-3">
                <Skeleton rounded="full" className="size-11" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-2/3" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              </div>
              <Skeleton rounded="lg" className="mt-5 h-24 w-full" />
            </Card>
          </Section>
        </Stagger>
      </div>

      <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="Recovery">
        <p className="text-[15px] leading-relaxed text-muted">
          Drag the handle down, flick, tap the backdrop or press Escape to dismiss.
        </p>
        <div className="mt-5 flex justify-center">
          <Dial size="md" value={78} max={100} format="percent" color={recoveryColor(78)} label="Recovery" delay={0.25} />
        </div>
        <div className="mt-4 divide-y divide-hairline">
          {today.stats.slice(0, 3).map((s) => (
            <StatRow key={s.id} {...s} />
          ))}
        </div>
        <div className="mt-5">
          <Button fullWidth onClick={() => setSheetOpen(false)}>
            Done
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
