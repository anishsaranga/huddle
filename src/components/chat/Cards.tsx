import type { ReactNode } from "react";
import { MessageText } from "./MessageText";

type CardProps = { body: string; payload: Record<string, unknown> | null; time: string; children?: ReactNode };

/** Full-width post from Huddle itself (`kind = "system"`). */
export function SystemCard({ body, time }: CardProps) {
  return (
    <div className="surface px-4 py-3.5">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="telemetry flex items-center gap-1.5">
          <span aria-hidden className="size-1.5 rounded-full bg-text-2" />
          HUDDLE
        </span>
        <span className="telemetry">{time}</span>
      </div>
      <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-text-2">
        <MessageText text={body} />
      </p>
    </div>
  );
}

/** Plain-text rendering of a payload value (text nodes only, bounded). */
function show(value: unknown): string {
  if (value === null || value === undefined) return "–";
  if (typeof value === "string") return value.slice(0, 200);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value).slice(0, 200);
  } catch {
    return "…";
  }
}

/**
 * Weekly champions post (`kind = "champions"`). Stub until the podium design
 * lands with the champions job: the headline, the body and the payload's
 * top-level fields as plain text.
 */
export function ChampionsCard({ body, payload, time }: CardProps) {
  const entries = payload ? Object.entries(payload).slice(0, 12) : [];
  return (
    <div className="surface surface-elevated overflow-hidden px-4 py-4" data-testid="champions-card">
      <div className="mb-2 flex items-center justify-between">
        <span className="telemetry flex items-center gap-1.5 text-text-2">
          <svg aria-hidden width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z" />
            <path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3" />
          </svg>
          WEEKLY CHAMPIONS
        </span>
        <span className="telemetry">{time}</span>
      </div>
      {body && (
        <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-text">
          <MessageText text={body} />
        </p>
      )}
      {entries.length > 0 && (
        <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 border-t border-hairline pt-3">
          {entries.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="telemetry">{k.slice(0, 40)}</dt>
              <dd className="truncate font-mono text-[12px] text-text-2">{show(v)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
