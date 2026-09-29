import type { ReactNode } from "react";

type EmptyStateProps = { title: string; children?: ReactNode; action?: ReactNode };

/** Dashed instrument-panel placeholder for empty lists. */
export function EmptyState({ title, children, action }: EmptyStateProps) {
  return (
    <div className="rounded-[var(--radius-card)] border border-dashed border-hairline-strong px-5 py-8 text-center">
      <p className="label mb-2">{title}</p>
      {children && <p className="mx-auto max-w-[28ch] text-[15px] leading-relaxed text-muted">{children}</p>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}
