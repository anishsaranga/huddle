import { AvatarStack } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Stagger, StaggerItem } from "@/components/ui/Stagger";
import type { IngestOverviewRow, UnknownFieldRow, UserSleepSources } from "@/lib/admin/data";
import type { SleepStage } from "@/lib/ingest/types";
import { alpha, STAGE_COLORS } from "@/lib/ui/colors";
import { formatNumber, formatRelative, formatShortDate } from "@/lib/ui/format";
import { userAvatarProps, UserChip } from "./UserBits";

/* ------------------------------ Unknown fields ------------------------------ */

export function UnknownFields({ rows, days }: { rows: UnknownFieldRow[]; days: number }) {
  if (rows.length === 0) {
    return (
      <EmptyState title="Nothing unknown yet">
        Fields your Shortcuts send that Huddle doesn&rsquo;t use yet show up here, as candidates for new features. Nothing in the last{" "}
        {days} days.
      </EmptyState>
    );
  }
  return (
    <Card padding="p-0">
      <ul aria-label="Unknown fields" className="divide-y divide-hairline">
        {rows.map((r) => (
          <li key={r.name} data-testid="unknown-field" className="px-4 py-3.5">
            <div className="flex items-start justify-between gap-3">
              <p className="min-w-0 break-all font-mono text-[14px] font-medium leading-tight text-text">{r.name}</p>
              <p className="num shrink-0 font-display text-[28px] font-bold leading-[0.85]">{formatNumber(r.total)}</p>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {r.types.map((t) => (
                <Badge key={t}>{t}</Badge>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2">
                <AvatarStack
                  size="sm"
                  people={r.users.slice(0, 4).map((u) => ({ id: u.id, ...userAvatarProps(u) }))}
                  total={r.users.length}
                />
                <span className="telemetry truncate">{r.users.map((u) => u.label).join(", ")}</span>
              </span>
              <span className="telemetry num shrink-0 text-right">
                {formatShortDate(r.firstSeen)}
                {r.firstSeen.getTime() !== r.lastSeen.getTime() && <> &rarr; {formatShortDate(r.lastSeen)}</>}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* --------------------------------- Sources ---------------------------------- */

const STAGE_LABEL: Record<SleepStage, string> = {
  in_bed: "in bed",
  asleep: "asleep",
  awake: "awake",
  core: "core",
  deep: "deep",
  rem: "rem",
};

function stageColor(stage: SleepStage): string {
  return stage === "in_bed" || stage === "asleep" ? "var(--muted)" : STAGE_COLORS[stage];
}

function StageChip({ stage }: { stage: SleepStage }) {
  const color = stageColor(stage);
  return (
    <span
      className="telemetry inline-flex items-center rounded-full px-2 py-[3px] leading-none"
      style={{ color, background: alpha(color, 12), boxShadow: `inset 0 0 0 1px ${alpha(color, 28)}` }}
    >
      {STAGE_LABEL[stage]}
    </span>
  );
}

export function SleepSources({ rows }: { rows: UserSleepSources[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState title="No sleep sources yet">
        Once someone syncs sleep, each device or app that wrote it appears here with the stages it writes.
      </EmptyState>
    );
  }
  return (
    <Stagger className="space-y-2">
      {rows.map(({ user, sources }) => (
        <StaggerItem key={user.id}>
          <article aria-label={`Sleep sources for ${user.label}`}>
            <Card padding="p-4">
              <UserChip user={user} sub={`${sources.length} ${sources.length === 1 ? "source" : "sources"}`} />
              <ul className="mt-3 divide-y divide-hairline border-t border-hairline">
                {sources.map((s) => {
                  const hasStages = s.stages.some((x) => x === "core" || x === "deep" || x === "rem");
                  return (
                    <li key={s.name} className="py-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="min-w-0 truncate text-[14px] font-medium text-text">{s.name}</p>
                        <Badge tone={hasStages ? "success" : "warning"}>{hasStages ? "Stages" : "No stages"}</Badge>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {s.stages.map((st) => (
                          <StageChip key={st} stage={st} />
                        ))}
                      </div>
                      <p className="telemetry num mt-2">
                        {s.nightsChosen > 0 ? `Won ${s.nightsChosen} ${s.nightsChosen === 1 ? "night" : "nights"} · ` : ""}
                        seen in {s.requests} {s.requests === 1 ? "sync" : "syncs"} · last {formatRelative(s.lastSeen)}
                      </p>
                    </li>
                  );
                })}
              </ul>
            </Card>
          </article>
        </StaggerItem>
      ))}
    </Stagger>
  );
}

/* ---------------------------- Ingest log entry ------------------------------ */

export function IngestLogLinks({ rows }: { rows: IngestOverviewRow[] }) {
  if (rows.length === 0) return <EmptyState title="No users yet">Each person&rsquo;s ingest log lives here.</EmptyState>;
  return (
    <Stagger className="space-y-2">
      {rows.map((r) => (
        <StaggerItem key={r.user.id}>
          <Card variant="interactive" href={`/admin/data/${r.user.id}`} chevron padding="p-4" ariaLabel={`Ingest log for ${r.user.label}`}>
            <UserChip
              user={r.user}
              size="md"
              sub={
                r.lastAt
                  ? `Last request ${formatRelative(r.lastAt)}`
                  : "No requests yet"
              }
            />
            <div className="mt-3 flex items-center gap-2">
              <Badge>
                {formatNumber(r.events)} {r.events === 1 ? "request" : "requests"}
              </Badge>
              {r.errors > 0 && <Badge tone="danger">{formatNumber(r.errors)} failed</Badge>}
            </div>
          </Card>
        </StaggerItem>
      ))}
    </Stagger>
  );
}
