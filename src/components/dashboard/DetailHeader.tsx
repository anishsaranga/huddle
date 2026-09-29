import Link from "next/link";

/** Detail-screen header: back chevron (to Home on the same date), centered title and date. */
export function DetailHeader({ title, dateLabel, backHref }: { title: string; dateLabel: string; backHref: string }) {
  return (
    <header className="pt-safe px-safe">
      <div className="nav-chrome grid grid-cols-[44px_1fr_44px] items-center px-3 pb-1 pt-3">
        <Link
          href={backHref}
          aria-label="Back to overview"
          className="grid size-11 place-items-center rounded-full text-text-2 transition-transform active:scale-90"
        >
          <span className="grid size-9 place-items-center rounded-full bg-white/[0.04] shadow-[inset_0_0_0_1px_var(--hairline)]">
            <svg aria-hidden width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4 6 9l5 5" />
            </svg>
          </span>
        </Link>
        <div className="text-center">
          <h1 className="font-display text-[22px] font-bold uppercase leading-none tracking-[0.08em]">{title}</h1>
          <p className="telemetry mt-1.5">{dateLabel}</p>
        </div>
        <span aria-hidden />
      </div>
    </header>
  );
}
