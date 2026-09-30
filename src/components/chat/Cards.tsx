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

/** Weekly champions post (`kind = "champions"`): see components/champions/ChampionsCard. */
export { ChampionsCard } from "@/components/champions/ChampionsCard";
