"use client";

import Link from "next/link";
import { useState, type CSSProperties } from "react";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Sheet } from "@/components/ui/Sheet";
import { COVERAGE_GROUPS, type CoverageColumn } from "@/lib/admin/coverage-columns";
import type { Coverage, CoverageUser } from "@/lib/admin/data";
import { alpha, SIGNAL } from "@/lib/ui/colors";
import { UserAvatar } from "./UserBits";

/** Fill of a heat cell: an empty hairline cell at 0%, ramping to the full signal color at 100%. */
export function cellStyle(pct: number): CSSProperties {
  if (pct <= 0) return { boxShadow: "inset 0 0 0 1px var(--hairline-strong)" };
  const strength = Math.round(16 + 0.84 * pct);
  return {
    background: alpha(SIGNAL.strain, strength),
    boxShadow:
      pct >= 100
        ? `inset 0 0 0 1px ${alpha(SIGNAL.strain, 90)}, 0 0 10px ${alpha(SIGNAL.strain, 35)}`
        : `inset 0 0 0 1px ${alpha(SIGNAL.strain, 30)}`,
  };
}

type Selected = { userId: string; key: string };

export function CoverageGrid({ coverage }: { coverage: Coverage }) {
  const { columns, users, windowDays } = coverage;
  const [selected, setSelected] = useState<Selected | null>(null);
  // The selection outlives the sheet so its content stays put while it slides away.
  const [open, setOpen] = useState(false);

  if (users.length === 0) {
    return <EmptyState title="No users yet">Coverage appears here once people sign in and sync.</EmptyState>;
  }

  const groups = COVERAGE_GROUPS.map((g) => ({ ...g, span: columns.filter((c) => c.group === g.id).length })).filter(
    (g) => g.span > 0,
  );
  const firstOfGroup = new Set(groups.map((g) => columns.find((c) => c.group === g.id)!.key));

  const user = selected ? users.find((u) => u.id === selected.userId) : undefined;
  const column = selected ? columns.find((c) => c.key === selected.key) : undefined;
  const cell = user && column ? user.cells[column.key] : undefined;

  return (
    <>
      <Card padding="p-0" className="overflow-hidden">
        <div className="overflow-x-auto overscroll-x-contain pb-2 [scrollbar-color:var(--hairline-strong)_transparent] [scrollbar-width:thin]">
          <table
            aria-label={`Data coverage, last ${windowDays} days`}
            className="border-separate border-spacing-x-[2px] border-spacing-y-[3px] pr-3 pt-3"
          >
            <thead>
              <tr>
                <th className="sticky left-0 z-20 bg-card" />
                {groups.map((g) => (
                  <th key={g.id} colSpan={g.span} scope="colgroup" className="telemetry pb-1 pl-1.5 text-left font-medium">
                    <span className="block truncate border-b border-hairline-strong pb-1">{g.label}</span>
                  </th>
                ))}
              </tr>
              <tr>
                <th
                  scope="col"
                  className="telemetry sticky left-0 z-20 bg-card pb-2 pl-4 pr-2 text-left align-bottom font-medium"
                >
                  User
                </th>
                {columns.map((c) => (
                  <th
                    key={c.key}
                    scope="col"
                    title={c.label}
                    className={`h-[74px] w-6 min-w-6 pb-1.5 align-bottom ${firstOfGroup.has(c.key) ? "pl-1.5" : ""}`}
                  >
                    <span
                      className="telemetry mx-auto block whitespace-nowrap text-[9.5px] tracking-[0.08em]"
                      style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
                    >
                      {c.short}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} aria-label={`Coverage for ${u.label}`}>
                  <th
                    scope="row"
                    className="sticky left-0 z-10 bg-card py-0.5 pl-4 pr-2 text-left font-normal shadow-[10px_0_10px_-8px_rgb(0_0_0/0.7)]"
                  >
                    <Link
                      href={`/admin/data/${u.id}`}
                      className="flex w-[104px] items-center gap-2 active:opacity-60"
                      aria-label={`Ingest log for ${u.label}`}
                    >
                      <UserAvatar user={u} size="sm" />
                      <span className="min-w-0 truncate text-[13px] font-semibold text-text">{u.label}</span>
                    </Link>
                  </th>
                  {columns.map((c) => (
                    <td key={c.key} className={`p-0 ${firstOfGroup.has(c.key) ? "pl-1.5" : ""}`}>
                      <Cell user={u} column={c} onOpen={() => {
                          setSelected({ userId: u.id, key: c.key });
                          setOpen(true);
                        }} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Legend windowDays={windowDays} />
      </Card>

      <Sheet open={open && !!(user && column && cell)} onClose={() => setOpen(false)} title={column?.label ?? ""}>
        {user && column && cell && <CellDetail user={user} cell={cell} windowDays={windowDays} />}
      </Sheet>
    </>
  );
}

function Cell({ user, column, onOpen }: { user: CoverageUser; column: CoverageColumn; onOpen: () => void }) {
  const c = user.cells[column.key];
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${user.label}, ${column.label}: ${c.pct}%`}
      title={`${user.label} · ${column.label}: ${c.pct}%`}
      data-pct={c.pct}
      className="block size-6 rounded-[6px] transition-transform active:scale-90"
      style={cellStyle(c.pct)}
    />
  );
}

function Legend({ windowDays }: { windowDays: number }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-hairline px-4 py-3">
      <p className="telemetry">% of last {windowDays} days with a value</p>
      <div className="flex shrink-0 items-center gap-1.5" aria-hidden>
        <span className="telemetry text-[9.5px]">0</span>
        {[0, 25, 50, 75, 100].map((p) => (
          <span key={p} className="block size-3.5 rounded-[4px]" style={cellStyle(p)} />
        ))}
        <span className="telemetry text-[9.5px]">100</span>
      </div>
    </div>
  );
}

function CellDetail({
  user,
  cell,
  windowDays,
}: {
  user: CoverageUser;
  cell: { days: number; pct: number };
  windowDays: number;
}) {
  return (
    <div>
      <div className="flex items-center gap-3">
        <UserAvatar user={user} size="md" />
        <div className="min-w-0">
          <p className="truncate text-[16px] font-semibold leading-tight">{user.label}</p>
          <p className="telemetry mt-1 truncate">{user.timezone ?? "UTC"}</p>
        </div>
      </div>

      <div className="mt-6 flex items-end gap-3">
        <p
          className="num font-display text-[72px] font-bold leading-[0.85]"
          style={{ color: cell.pct > 0 ? SIGNAL.strain : "var(--dim)" }}
        >
          {cell.pct}
          <span className="ml-1 text-[28px] text-muted">%</span>
        </p>
        <p className="telemetry num pb-1">
          {cell.days} / {windowDays} days
        </p>
      </div>

      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-[var(--track)]" aria-hidden>
        <div className="h-full rounded-full" style={{ width: `${cell.pct}%`, background: SIGNAL.strain }} />
      </div>

      <p className="telemetry mt-4">
        Window {user.window.from} to {user.window.to}
      </p>
      <p className="mt-2 text-[14px] leading-relaxed text-muted">
        {cell.pct === 0
          ? "No value in this window. Either the device never writes it or the Shortcut doesn’t send it."
          : "Days in the window with a stored value, in this person’s own timezone."}
      </p>

      <Link
        href={`/admin/data/${user.id}`}
        className="mt-5 flex h-11 items-center justify-center rounded-full bg-white/[0.03] text-[13px] font-semibold uppercase tracking-[0.12em] shadow-[inset_0_0_0_1px_var(--hairline-strong),inset_0_1px_0_rgb(255_255_255/0.06)] active:opacity-70"
      >
        Open ingest log
      </Link>
    </div>
  );
}
