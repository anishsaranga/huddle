import Link from "next/link";
import { AvatarStack, type AvatarUser } from "@/components/ui/Avatar";

type GroupHeaderProps = {
  name: string;
  timezone: string;
  memberCount: number;
  people: { id: string; label: string; user: AvatarUser }[];
};

/** Group screen header: back to the group list, name, member count + timezone, avatar stack. */
export function GroupHeader({ name, timezone, memberCount, people }: GroupHeaderProps) {
  return (
    <header className="pt-safe px-safe">
      <div className="nav-chrome grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-2 pb-3 pl-3 pr-4 pt-3">
        <Link
          href="/groups"
          aria-label="Back to groups"
          className="grid size-11 place-items-center rounded-full text-text-2 transition-transform active:scale-90"
        >
          <span className="grid size-9 place-items-center rounded-full bg-white/[0.04] shadow-[inset_0_0_0_1px_var(--hairline)]">
            <svg aria-hidden width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4 6 9l5 5" />
            </svg>
          </span>
        </Link>
        <div className="min-w-0">
          <h1 className="truncate font-display text-[28px] font-bold uppercase leading-[0.95] tracking-[0.03em]">{name}</h1>
          <p className="telemetry mt-1 truncate">
            {memberCount} {memberCount === 1 ? "MEMBER" : "MEMBERS"} · {timezone}
          </p>
        </div>
        <AvatarStack people={people.slice(0, 3)} total={memberCount} size="sm" />
      </div>
    </header>
  );
}
