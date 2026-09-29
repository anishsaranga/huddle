import Link from "next/link";
import type { ReactNode } from "react";
import { signOutAction } from "@/app/(auth)/actions";
import { KeySection } from "@/components/apikey/KeySection";
import { SubmitButton } from "@/components/auth/SubmitButton";
import { ProfileView } from "@/components/profile/ProfileView";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { db } from "@/db";
import { getKeyStatus } from "@/lib/apikey";
import { getIngestUrl } from "@/lib/app-url";
import { toProfileData } from "@/lib/profile/service";
import { requireOnboardedUser } from "@/lib/session";

export const metadata = { title: "Profile" };

const chevron = (
  <svg
    aria-hidden
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="shrink-0 text-dim"
  >
    <path d="m6 3.5 4.5 4.5L6 12.5" />
  </svg>
);

function RowBody({ label, hint, badge }: { label: string; hint: string; badge?: ReactNode }) {
  return (
    <>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium leading-tight text-text">{label}</span>
        <span className="mt-1 block text-[13px] leading-snug text-muted">{hint}</span>
      </span>
      {badge}
    </>
  );
}

function LinkRow({ href, label, hint }: { href: string; label: string; hint: string }) {
  return (
    <Link href={href} className="flex min-h-[64px] items-center gap-3 px-5 py-3 transition-colors active:bg-white/[0.04]">
      <RowBody label={label} hint={hint} />
      {chevron}
    </Link>
  );
}

/** Placeholder row for a feature that ships in a later milestone. */
function SoonRow({ label, hint }: { label: string; hint: string }) {
  return (
    <div aria-disabled="true" className="flex min-h-[64px] items-center gap-3 px-5 py-3 opacity-55">
      <RowBody label={label} hint={hint} badge={<Badge>Soon</Badge>} />
    </div>
  );
}

export default async function ProfilePage() {
  const user = await requireOnboardedUser();
  const [key, ingestUrl] = await Promise.all([getKeyStatus(db, user.id), getIngestUrl()]);

  return (
    <ProfileView user={toProfileData(user)}>
      {user.isAdmin && (
        <Card variant="interactive" href="/admin" chevron ariaLabel="Admin">
          <p className="telemetry mb-2" style={{ color: "var(--strain)" }}>
            Admin
          </p>
          <p className="font-display text-[26px] font-semibold uppercase leading-none tracking-[0.02em]">
            Manage Huddle
          </p>
          <p className="mt-2 text-[14px] leading-snug text-muted">Allowlist, groups and users.</p>
        </Card>
      )}

      <KeySection
        initial={{
          active: key.active,
          prefixHint: key.prefixHint,
          createdAt: key.createdAt?.toISOString() ?? null,
          lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
        }}
        ingestUrl={ingestUrl}
      />

      <Card padding="p-0" className="divide-y divide-hairline overflow-hidden">
        <LinkRow href="/setup" label="Sync setup" hint="Connect your iPhone Shortcut" />
        <LinkRow href="/credits" label="Avatar credits" hint="Artists behind the characters" />
        <SoonRow label="Export my data" hint="Download everything as JSON" />
        <SoonRow label="Delete account" hint="Remove your account and data" />
      </Card>

      <form action={signOutAction} className="pt-3">
        <SubmitButton variant="secondary" fullWidth>
          Sign out
        </SubmitButton>
      </form>
    </ProfileView>
  );
}
