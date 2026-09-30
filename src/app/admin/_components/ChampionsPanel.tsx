"use client";

import { useState, useTransition } from "react";
import { TrophyGlyph } from "@/components/champions/Flair";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ConfirmSheet } from "@/components/ui/ConfirmSheet";
import { useToast } from "@/components/ui/Toast";
import type { ChampionsAdminStatus, ChampionsDryRun } from "@/lib/champions/admin";
import { CATEGORY_META, formatChampionValue } from "@/lib/champions/types";
import { alpha } from "@/lib/ui/colors";
import { championsDryRunAction, postChampionsNowAction } from "../actions";
import { useAdminAction } from "./useAdminAction";

export type WorkerJobView = {
  job: string;
  schedule: string | null;
  state: "never" | "ok" | "error" | "running";
  /** Relative labels ("3 h ago"), formatted on the server. */
  lastRun: string | null;
  lastOk: string | null;
  error: string | null;
};

type ChampionsPanelProps = {
  groupId: string;
  status: ChampionsAdminStatus;
  lastPostLabel: string | null;
  jobs: WorkerJobView[];
};

const STATE_DOT: Record<WorkerJobView["state"], string> = {
  never: "var(--dim)",
  ok: "var(--recovery-green)",
  error: "var(--recovery-red)",
  running: "var(--strain)",
};

const STATE_TEXT: Record<WorkerJobView["state"], string> = { never: "NEVER RUN", ok: "OK", error: "ERROR", running: "RUNNING" };

function DryRunResult({ dry }: { dry: ChampionsDryRun }) {
  if (!dry.ok) {
    return (
      <p className="mt-4 rounded-2xl bg-card-sunken px-4 py-3 text-[14px] leading-relaxed text-muted shadow-[inset_0_0_0_1px_var(--hairline)]">
        Nothing to post for {dry.weekLabel}: fewer than 2 members have 4 or more days of data.
      </p>
    );
  }
  return (
    <div className="mt-4 space-y-3" data-testid="champions-dry-run">
      <div className="flex flex-wrap items-center gap-2">
        <span className="telemetry text-text-2">DRY RUN · {dry.weekLabel}</span>
        <span
          className="telemetry rounded-full px-2 py-[3px] text-[8.5px]"
          style={
            dry.source === "gemini"
              ? { color: "var(--sleep)", background: alpha("var(--sleep)", 14) }
              : { color: "var(--text-2)", background: "rgb(255 255 255 / 0.07)" }
          }
        >
          {dry.source === "gemini" ? "GEMINI" : "TEMPLATE"}
          {dry.fallbackReason ? ` · ${dry.fallbackReason.replaceAll("_", " ")}` : ""}
        </span>
        {dry.alreadyPosted && <span className="telemetry text-[8.5px] text-recovery-yellow">ALREADY POSTED</span>}
      </div>
      <p className="whitespace-pre-wrap break-words rounded-2xl bg-card-sunken px-4 py-3 text-[15px] leading-relaxed text-text shadow-[inset_0_0_0_1px_var(--hairline)]">
        {dry.text}
      </p>
      <ul className="divide-y divide-hairline overflow-hidden rounded-2xl bg-card-sunken shadow-[inset_0_0_0_1px_var(--hairline)]">
        {dry.categories.map((c) => {
          const meta = CATEGORY_META[c.category];
          const w = c.winners[0];
          return (
            <li key={c.category} className="flex items-center gap-3 px-4 py-2.5">
              <span aria-hidden className="size-[7px] shrink-0 rounded-full" style={{ background: meta.color }} />
              <span className="min-w-0 flex-1">
                <span className="telemetry block text-[9px]" style={{ color: meta.color }}>
                  {meta.title}
                </span>
                <span className="block truncate text-[14px] font-semibold">{w.displayName}</span>
                {c.runnersUp.length > 0 && (
                  <span className="block truncate font-mono text-[11px] text-muted">
                    {c.runnersUp.map((r, i) => `${i + 2}. ${r.displayName} ${formatChampionValue(c.category, r.value)}`).join("  ·  ")}
                  </span>
                )}
              </span>
              <span className="num shrink-0 font-mono text-[13px] text-text-2">{formatChampionValue(c.category, w.value)}</span>
            </li>
          );
        })}
      </ul>
      <p className="telemetry text-[9px]">{dry.eligible} MEMBERS QUALIFIED · NOTHING WAS POSTED</p>
    </div>
  );
}

export function ChampionsPanel({ groupId, status, lastPostLabel, jobs }: ChampionsPanelProps) {
  const { toast } = useToast();
  const [dry, setDry] = useState<ChampionsDryRun | null>(null);
  const [dryPending, startDry] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const post = useAdminAction();

  const runDry = () =>
    startDry(async () => {
      try {
        const r = await championsDryRunAction(groupId);
        if (r.ok) setDry(r.dry);
        else toast({ title: "Dry run failed", description: r.error, tone: "error" });
      } catch {
        toast({ title: "Couldn't reach the server", tone: "error" });
      }
    });

  return (
    <section aria-label="Weekly champions" className="mt-8 space-y-3">
      <p className="label">Weekly champions</p>
      <Card>
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-white shadow-[0_0_16px_rgb(255_255_255/0.25)]">
            <TrophyGlyph size={18} />
          </span>
          <div className="min-w-0 flex-1 space-y-1">
            <p className="telemetry">Last post</p>
            <p className="text-[15px] font-semibold leading-tight" data-testid="champions-last-post">
              {status.lastPost ? (
                <>
                  {lastPostLabel}
                  {status.lastPost.weekLabel && <span className="font-normal text-muted"> · {status.lastPost.weekLabel}</span>}
                </>
              ) : (
                <span className="text-muted">Never</span>
              )}
            </p>
            <p className="telemetry pt-1 text-[9.5px]">
              LAST WEEK · {status.weekLabel} ·{" "}
              <span className={status.posted ? "text-recovery-green" : status.due ? "text-recovery-yellow" : "text-text-2"}>
                {status.posted ? "POSTED" : status.due ? "DUE ON THE NEXT RUN" : "DUE MON 09:00"}
              </span>
            </p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button variant="secondary" loading={dryPending} onClick={runDry}>
            Dry run
          </Button>
          <Button variant="primary" onClick={() => setConfirmOpen(true)}>
            Post now
          </Button>
        </div>
        {dry && <DryRunResult dry={dry} />}
      </Card>

      <p className="label pt-3">Worker</p>
      <Card padding="p-0">
        <ul className="divide-y divide-hairline" aria-label="Worker jobs">
          {jobs.map((j) => (
            <li key={j.job} className="px-4 py-3" data-testid={`worker-job-${j.job}`}>
              <div className="flex items-center gap-2.5">
                <span
                  aria-hidden
                  className="size-[7px] shrink-0 rounded-full"
                  style={{ background: STATE_DOT[j.state], boxShadow: j.state === "never" ? undefined : `0 0 8px ${alpha(STATE_DOT[j.state], 60)}` }}
                />
                <span className="min-w-0 flex-1 truncate font-mono text-[13px] font-medium text-text">{j.job}</span>
                <span className="telemetry text-[9px]" style={{ color: j.state === "error" ? "var(--recovery-red)" : undefined }}>
                  {STATE_TEXT[j.state]}
                </span>
              </div>
              <p className="telemetry mt-1 pl-[17px] text-[9px]">
                {j.lastRun ? `RAN ${j.lastRun.toUpperCase()}` : "NO RUNS YET"}
                {j.lastOk && j.state === "error" ? ` · LAST OK ${j.lastOk.toUpperCase()}` : ""}
                {j.schedule ? ` · ${j.schedule.toUpperCase()}` : ""}
              </p>
              {j.error && <p className="mt-1.5 truncate pl-[17px] font-mono text-[11px] text-recovery-red/90">{j.error}</p>}
            </li>
          ))}
        </ul>
      </Card>

      <ConfirmSheet
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Post weekly champions?"
        confirmLabel="Post to the group"
        pending={post.pending}
        onConfirm={() =>
          post.run(() => postChampionsNowAction(groupId), {
            onSuccess: () => setConfirmOpen(false),
            onError: () => setConfirmOpen(false),
          })
        }
      >
        <p>
          The champions for <span className="font-medium text-text">{status.weekLabel}</span> go into the group chat for every
          member. If that week was already posted, nothing happens.
        </p>
      </ConfirmSheet>
    </section>
  );
}
