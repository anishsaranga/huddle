import type { ReactNode } from "react";
import { Avatar, type AvatarSize } from "@/components/ui/Avatar";
import type { UserRef } from "@/lib/admin/data";

/** A `UserRef` as the props <Avatar> wants. */
export function userAvatarProps(u: UserRef) {
  return {
    user: {
      id: u.id,
      displayName: u.label,
      username: u.username,
      avatarKind: u.avatarKind,
      avatarConfig: u.avatarConfig,
      avatarPath: u.avatarPath,
    },
    label: u.label,
  };
}

export function UserAvatar({ user, size = "sm" }: { user: UserRef; size?: AvatarSize }) {
  return <Avatar {...userAvatarProps(user)} size={size} />;
}

/** Avatar + name (+ optional second line), truncating. */
export function UserChip({ user, sub, size = "sm" }: { user: UserRef; sub?: ReactNode; size?: AvatarSize }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <UserAvatar user={user} size={size} />
      <span className="min-w-0">
        <span className="block truncate text-[14px] font-semibold leading-tight text-text">{user.label}</span>
        {sub && <span className="telemetry mt-0.5 block truncate">{sub}</span>}
      </span>
    </span>
  );
}

/** Section wrapper for the Data page: title and blurb. */
export function DataSection({
  id,
  title,
  children,
  blurb,
}: {
  id: string;
  title: string;
  blurb?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="mt-9">
      <h2 id={id} className="font-display text-[26px] font-bold uppercase leading-none tracking-[0.03em]">
        {title}
      </h2>
      {blurb ? <p className="mb-4 mt-2 text-[14px] leading-relaxed text-muted">{blurb}</p> : <div className="mb-4" />}
      {children}
    </section>
  );
}
