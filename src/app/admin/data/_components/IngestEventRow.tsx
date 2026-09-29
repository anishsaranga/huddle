"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import type { IngestEventBody, IngestEventDetail, IngestLogRow } from "@/lib/admin/data";
import { ease } from "@/lib/ui/motion";
import { formatBytes, formatNumber } from "@/lib/ui/format";
import { getIngestEventBodyAction, getIngestEventDetailAction } from "../actions";
import { FieldInventory } from "./FieldInventory";
import { JsonViewer } from "./JsonViewer";

/** 200 green, 429 and 5xx red, other 4xx yellow. */
export function statusTone(status: number): BadgeTone {
  if (status >= 200 && status < 300) return "success";
  if (status === 429 || status >= 500) return "danger";
  if (status >= 400) return "warning";
  return "neutral";
}

export type IngestEventRowProps = {
  row: IngestLogRow;
  /** Preformatted on the server so server and client render the same text. */
  relative: string;
  absolute: string;
};

const arrow = "→";

function rangeText(row: IngestLogRow): string | null {
  const s = row.summary;
  if (!s) return null;
  const days = `${s.days} ${s.days === 1 ? "day" : "days"}`;
  if (!s.dateRange) return days;
  const { from, to } = s.dateRange;
  return from === to ? `${days} · ${from}` : `${days} · ${from} ${arrow} ${to}`;
}

export function IngestEventRow({ row, relative, absolute }: IngestEventRowProps) {
  const [open, setOpen] = useState(false);
  const panelId = `ingest-event-${row.id}`;
  const range = rangeText(row);
  const s = row.summary;
  const rows =
    s && (s.rowsInserted !== undefined || s.rowsUpdated !== undefined)
      ? `${formatNumber(s.rowsInserted ?? 0)} new · ${formatNumber(s.rowsUpdated ?? 0)} updated`
      : null;

  return (
    <li data-testid="ingest-event" data-status={row.status}>
      <Card padding="p-0">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-start gap-3 rounded-[inherit] p-4 text-left active:bg-white/[0.02]"
        >
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <Badge tone={statusTone(row.status)}>{row.status}</Badge>
              <span className="text-[15px] font-semibold leading-tight text-text">{relative}</span>
              {row.errors?.reason && <span className="telemetry">{row.errors.reason.replaceAll("_", " ")}</span>}
            </div>
            <p className="telemetry num mt-1.5">{absolute} UTC</p>
            <p className="telemetry num mt-2 flex flex-wrap gap-x-2.5 gap-y-1">
              <span>{row.authMethod}</span>
              <span>{formatBytes(row.bytes)}</span>
              <span>{formatNumber(row.durationMs)} ms</span>
            </p>
            {(range || rows) && (
              <p className="telemetry num mt-1.5 flex flex-wrap gap-x-2.5 gap-y-1 text-text-2">
                {range && <span>{range}</span>}
                {rows && <span>{rows}</span>}
              </p>
            )}
          </div>
          <svg
            aria-hidden
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`mt-1 shrink-0 text-dim transition-transform duration-200 ${open ? "rotate-90" : ""}`}
          >
            <path d="m6 3.5 4.5 4.5L6 12.5" />
          </svg>
        </button>

        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              id={panelId}
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.22, ease: ease.out }}
              className="border-t border-hairline px-4 pb-4 pt-4"
            >
              <Expanded row={row} />
            </motion.div>
          )}
        </AnimatePresence>
      </Card>
    </li>
  );
}

/* --------------------------------- Expanded --------------------------------- */

type Load<T> = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; value: T };

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-5 first:mt-0">
      <h3 className="label mb-2.5">{title}</h3>
      {children}
    </section>
  );
}

function Expanded({ row }: { row: IngestLogRow }) {
  const s = row.summary;
  const [detail, setDetail] = useState<Load<IngestEventDetail>>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);

  // Load the per-day inventory when the row opens (and again on Retry).
  useEffect(() => {
    let cancelled = false;
    getIngestEventDetailAction(row.id)
      .then((r) => !cancelled && setDetail(r.ok ? { state: "ready", value: r.detail } : { state: "error", message: r.error }))
      .catch(() => !cancelled && setDetail({ state: "error", message: "Couldn’t reach the server." }));
    return () => {
      cancelled = true;
    };
  }, [row.id, attempt]);

  const facts: [string, string][] = [];
  if (s) {
    if (s.tz) facts.push(["Timezone", `${s.tz}${s.tzSource ? ` (${s.tzSource})` : ""}`]);
    if (s.tzIgnored) facts.push(["Ignored tz", s.tzIgnored]);
    if (s.hrHourlyCount !== undefined) facts.push(["HR hourly rows", `${s.hrHourlyCount} in ${s.hrHourlyDays ?? 0} days`]);
    if (s.sleepSegmentCount !== undefined) facts.push(["Sleep segments", String(s.sleepSegmentCount)]);
    if (s.nightsWritten !== undefined) facts.push(["Nights written", String(s.nightsWritten)]);
    if (s.napsIgnored) facts.push(["Naps ignored", String(s.napsIgnored)]);
    if (s.gzip) facts.push(["Gzip", s.decodedBytes ? `${formatBytes(s.decodedBytes)} decoded` : "yes"]);
    if (s.duplicateDates?.length) facts.push(["Duplicate days", String(s.duplicateDates.length)]);
  }
  const unknown = s?.unknownFields ? Object.keys(s.unknownFields) : [];
  const sources = s?.sleepSources ? Object.entries(s.sleepSources) : [];
  const issues = row.errors?.issues ?? [];

  return (
    <div>
      {row.errors && (
        <Block title="Error">
          <div className="rounded-xl bg-card-sunken p-3 shadow-[inset_0_0_0_1px_var(--hairline)]">
            <p className="font-mono text-[12.5px] text-text">{row.errors.reason ?? "error"}</p>
            {row.errors.detail && <p className="mt-1 break-words text-[13px] text-muted">{row.errors.detail}</p>}
            {issues.length > 0 && (
              <ul className="mt-2 space-y-1.5">
                {issues.slice(0, 20).map((i, n) => (
                  <li key={n} className="text-[12.5px] leading-snug text-text-2">
                    <span className="font-mono text-muted">{i.path.length ? i.path.join(".") : "(body)"}</span> {i.message}
                  </li>
                ))}
                {issues.length > 20 && <li className="telemetry">+{issues.length - 20} more</li>}
              </ul>
            )}
          </div>
        </Block>
      )}

      {(facts.length > 0 || unknown.length > 0 || sources.length > 0) && (
        <Block title="Summary">
          {facts.length > 0 && (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              {facts.map(([k, v]) => (
                <div key={k} className="min-w-0">
                  <dt className="telemetry">{k}</dt>
                  <dd className="num mt-0.5 break-words text-[13px] font-medium text-text">{v}</dd>
                </div>
              ))}
            </dl>
          )}
          {sources.length > 0 && (
            <div className={facts.length > 0 ? "mt-3.5" : ""}>
              <p className="telemetry mb-1.5">Sleep sources</p>
              <ul className="space-y-1">
                {sources.map(([name, stages]) => (
                  <li key={name} className="text-[13px] text-text-2">
                    <span className="font-medium text-text">{name || "Unknown source"}</span>
                    <span className="font-mono text-[11.5px] text-muted"> {stages.join(", ")}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {unknown.length > 0 && (
            <div className={facts.length > 0 || sources.length > 0 ? "mt-3.5" : ""}>
              <p className="telemetry mb-1.5">Unknown fields</p>
              <div className="flex flex-wrap gap-1.5">
                {unknown.map((u) => (
                  <Badge key={u} tone="admin" className="!normal-case !tracking-normal">
                    {u}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </Block>
      )}

      <Block title="Field inventory">
        {detail.state === "loading" && <Skeleton className="h-24 w-full" rounded="lg" />}
        {detail.state === "error" && <LoadError message={detail.message} onRetry={() => {
              setDetail({ state: "loading" });
              setAttempt((n) => n + 1);
            }} />}
        {detail.state === "ready" && <FieldInventory fields={detail.value.fields ?? null} />}
      </Block>

      <Block title="Raw body">
        <RawBody id={row.id} />
      </Block>
    </div>
  );
}

function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex items-center justify-between gap-3">
      <p className="text-[13px] text-recovery-red">{message}</p>
      <button type="button" onClick={onRetry} className="telemetry h-8 shrink-0 rounded-full px-3 text-text-2 shadow-[inset_0_0_0_1px_var(--hairline-strong)]">
        Retry
      </button>
    </div>
  );
}

/** Collapsed until asked for: the body can be megabytes, so it's fetched only then. */
function RawBody({ id }: { id: number }) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState<Load<IngestEventBody> | null>(null);

  function load() {
    setBody({ state: "loading" });
    getIngestEventBodyAction(id)
      .then((r) => setBody(r.ok ? { state: "ready", value: r.body } : { state: "error", message: r.error }))
      .catch(() => setBody({ state: "error", message: "Couldn’t reach the server." }));
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !body) load();
  }

  return (
    <div>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="telemetry inline-flex h-9 items-center gap-2 rounded-full bg-white/[0.04] px-3.5 text-text-2 shadow-[inset_0_0_0_1px_var(--hairline-strong)] transition-opacity active:opacity-60"
      >
        <svg
          aria-hidden
          width="10"
          height="10"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`transition-transform duration-200 ${open ? "rotate-90" : ""}`}
        >
          <path d="m6 3.5 4.5 4.5L6 12.5" />
        </svg>
        {open ? "Hide body" : "Show body"}
      </button>
      {open && (
        <div className="mt-3">
          {body?.state === "loading" && <Skeleton className="h-40 w-full" rounded="lg" />}
          {body?.state === "error" && <LoadError message={body.message} onRetry={load} />}
          {body?.state === "ready" && (
            <JsonViewer text={body.value.text} truncated={body.value.truncated} totalBytes={body.value.totalBytes} />
          )}
        </div>
      )}
    </div>
  );
}
