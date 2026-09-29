"use client";

import { useState } from "react";
import type { IngestSummary } from "@/lib/ingest/types";
import { alpha, SIGNAL } from "@/lib/ui/colors";

type Fields = NonNullable<IngestSummary["fields"]>;

const STATES = [
  { key: "present", title: "Present", color: SIGNAL.strain, hint: "Sent with a value" },
  { key: "nulls", title: "Null", color: SIGNAL.yellow, hint: "Sent as null or empty (clears the stored value)" },
  { key: "absent", title: "Absent", color: "var(--dim)", hint: "Not in the payload (stored value untouched)" },
] as const;

function Chip({ name, color, state }: { name: string; color: string; state: string }) {
  return (
    <span
      data-state={state}
      className="inline-flex items-center rounded-full px-2 py-[3px] font-mono text-[10.5px] leading-none"
      style={{ color, background: alpha(color, state === "absent" ? 6 : 12), boxShadow: `inset 0 0 0 1px ${alpha(color, state === "absent" ? 40 : 28)}` }}
    >
      {name}
    </span>
  );
}

/**
 * Which known metric fields each day of a request carried: present, sent as
 * null, or absent. A date strip picks the day (newest first).
 */
export function FieldInventory({ fields }: { fields: Fields | null }) {
  const dates = fields ? Object.keys(fields.perDay).sort().reverse() : [];
  const [picked, setPicked] = useState<string | null>(null);

  if (!fields || dates.length === 0) {
    return <p className="telemetry py-2">No field inventory: the request was rejected before its days were read.</p>;
  }

  const date = picked && fields.perDay[picked] ? picked : dates[0];
  const inv = fields.perDay[date];

  return (
    <div>
      {dates.length > 1 && (
        <div
          role="tablist"
          aria-label="Day"
          className="no-scrollbar -mx-4 mb-3 flex gap-1.5 overflow-x-auto px-4 pb-1"
        >
          {dates.map((d) => {
            const active = d === date;
            return (
              <button
                key={d}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setPicked(d)}
                className={`telemetry num h-8 shrink-0 rounded-full px-3 transition-colors ${
                  active ? "bg-white text-bg" : "bg-white/[0.04] text-text-2 shadow-[inset_0_0_0_1px_var(--hairline-strong)]"
                }`}
              >
                {d.slice(5)}
              </button>
            );
          })}
        </div>
      )}
      <p className="telemetry num mb-3">{date}</p>
      <div className="space-y-3.5">
        {STATES.map((s) => {
          const names = inv[s.key];
          return (
            <div key={s.key} data-testid={`inventory-${s.key}`}>
              <p className="telemetry mb-1.5 flex items-center gap-2" title={s.hint}>
                <span aria-hidden className="size-1.5 rounded-full" style={{ background: s.color }} />
                {s.title} <span className="num text-text-2">{names.length}</span>
              </p>
              {names.length === 0 ? (
                <p className="text-[13px] text-dim">None</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {names.map((n) => (
                    <Chip key={n} name={n} color={s.color} state={s.key} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
