import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { EmptyState } from "@/components/ui/EmptyState";
import { getIngestLog, parseIngestFilter } from "@/lib/admin/data";
import { idSchema } from "@/lib/admin/schemas";
import { requireAdmin } from "@/lib/session";
import { formatNumber, formatRelative, formatUtcStamp } from "@/lib/ui/format";
import { IngestEventRow } from "../_components/IngestEventRow";
import { LogFilter } from "../_components/LogFilter";
import { UserAvatar } from "../_components/UserBits";

export const metadata = { title: "Ingest log · Admin" };

type Props = {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

function hrefFor(userId: string, page: number, status: string): string {
  const qs = new URLSearchParams();
  if (status !== "all") qs.set("status", status);
  if (page > 1) qs.set("page", String(page));
  const s = qs.toString();
  return `/admin/data/${userId}${s ? `?${s}` : ""}`;
}

export default async function IngestLogPage({ params, searchParams }: Props) {
  await requireAdmin();
  const { userId } = await params;
  if (!idSchema.safeParse(userId).success) notFound();
  const sp = await searchParams;
  const filter = parseIngestFilter(first(sp.status));
  const page = Number.parseInt(first(sp.page) ?? "1", 10);

  const log = await getIngestLog(db, { userId, filter, page: Number.isFinite(page) ? page : 1 });
  if (!log) notFound();
  const now = new Date();

  return (
    <>
      <Link
        href="/admin/data"
        className="telemetry -ml-2 mb-3 inline-flex h-9 items-center gap-1 px-2 text-text-2 active:opacity-60"
      >
        <svg aria-hidden width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="m10 3.5-4.5 4.5L10 12.5" />
        </svg>
        Data coverage
      </Link>

      <header className="mb-5 flex items-center gap-3.5">
        <UserAvatar user={log.user} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="telemetry mb-1.5">Ingest log</p>
          <h1 className="font-display text-[36px] font-bold uppercase leading-[0.9] tracking-[0.02em] [overflow-wrap:anywhere]">
            {log.user.label}
          </h1>
          <p className="telemetry mt-1.5 truncate">
            {log.user.username ? `@${log.user.username} · ` : ""}
            {log.user.timezone ?? "UTC"}
          </p>
        </div>
      </header>

      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="telemetry num" aria-live="polite">
          {formatNumber(log.total)} {log.total === 1 ? "request" : "requests"}
        </p>
        <div className="w-[210px]">
          <LogFilter value={filter} />
        </div>
      </div>

      {log.rows.length === 0 ? (
        <EmptyState title={filter === "all" ? "No requests yet" : "Nothing here"}>
          {filter === "all"
            ? "Requests from this person's Shortcut appear here as they arrive."
            : filter === "ok"
              ? "No successful requests yet."
              : "No failed requests. That's good."}
        </EmptyState>
      ) : (
        <ul aria-label="Ingest events" className="space-y-2">
          {log.rows.map((r) => (
            <IngestEventRow key={r.id} row={r} relative={formatRelative(r.receivedAt, now)} absolute={formatUtcStamp(r.receivedAt)} />
          ))}
        </ul>
      )}

      {log.pageCount > 1 && (
        <nav aria-label="Pages" className="mt-6 flex items-center justify-between gap-3">
          <PageLink href={hrefFor(userId, log.page - 1, filter)} disabled={log.page <= 1} label="Newer" dir="prev" />
          <p className="telemetry num">
            Page {log.page} of {log.pageCount}
          </p>
          <PageLink href={hrefFor(userId, log.page + 1, filter)} disabled={log.page >= log.pageCount} label="Older" dir="next" />
        </nav>
      )}
    </>
  );
}

function PageLink({ href, disabled, label, dir }: { href: string; disabled: boolean; label: string; dir: "prev" | "next" }) {
  const cls =
    "telemetry inline-flex h-10 min-w-[92px] items-center justify-center gap-1.5 rounded-full px-4 shadow-[inset_0_0_0_1px_var(--hairline-strong)]";
  const chevron = (
    <svg aria-hidden width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={dir === "prev" ? "m10 3.5-4.5 4.5L10 12.5" : "m6 3.5 4.5 4.5L6 12.5"} />
    </svg>
  );
  const inner = dir === "prev" ? (
    <>
      {chevron}
      {label}
    </>
  ) : (
    <>
      {label}
      {chevron}
    </>
  );
  if (disabled) {
    return (
      <span aria-disabled="true" className={`${cls} opacity-35`}>
        {inner}
      </span>
    );
  }
  return (
    <Link href={href} rel={dir} className={`${cls} text-text-2 active:opacity-60`}>
      {inner}
    </Link>
  );
}
