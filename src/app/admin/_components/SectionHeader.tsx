import type { ReactNode } from "react";

type SectionHeaderProps = {
  kicker: string;
  title: string;
  /** Right-aligned slot (a button). */
  action?: ReactNode;
  children?: ReactNode;
};

/** Page heading inside the admin area: mono kicker, Barlow Condensed title, optional blurb. */
export function SectionHeader({ kicker, title, action, children }: SectionHeaderProps) {
  return (
    <header className="mb-5">
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="telemetry mb-2">{kicker}</p>
          <h1 className="font-display text-[40px] font-bold uppercase leading-[0.9] tracking-[0.02em] [overflow-wrap:anywhere]">
            {title}
          </h1>
        </div>
        {action && <div className="shrink-0 pb-1">{action}</div>}
      </div>
      {children && <p className="mt-3 text-[15px] leading-relaxed text-muted">{children}</p>}
    </header>
  );
}
