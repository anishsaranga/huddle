import type { ReactNode } from "react";

type PageHeaderProps = {
  title: string;
  /** Small ALL-CAPS kicker above the title. */
  subtitle?: string;
  /** Right-aligned slot (e.g. a small button). */
  action?: ReactNode;
};

export function PageHeader({ title, subtitle, action }: PageHeaderProps) {
  return (
    <header className="pt-safe px-safe">
      <div className="flex items-end justify-between gap-4 px-5 pb-5 pt-6">
        <div className="min-w-0">
          {subtitle && <p className="telemetry mb-2">{subtitle}</p>}
          <h1 className="font-display text-[40px] font-bold uppercase leading-[0.9] tracking-[0.02em]">
            {title}
          </h1>
        </div>
        {action && <div className="shrink-0 pb-1">{action}</div>}
      </div>
    </header>
  );
}
