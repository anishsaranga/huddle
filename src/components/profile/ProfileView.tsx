"use client";

import { motion } from "motion/react";
import { useCallback, useState, type ReactNode } from "react";
import { AmbientGlow } from "@/components/ui/AmbientGlow";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Stagger, StaggerItem } from "@/components/ui/Stagger";
import { ageOn, formatHeight, formatSleepGoal, formatWeight, SEX_LABELS, sexSchema } from "@/lib/profile/schema";
import type { ProfileData } from "@/lib/profile/types";
import { SIGNAL } from "@/lib/ui/colors";
import { formatNumber, formatMonthYear, formatShortDate } from "@/lib/ui/format";
import { spring } from "@/lib/ui/motion";
import { EditSheets, type SheetKind } from "./EditSheets";

function Row({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="flex min-h-9 items-baseline justify-between gap-4 py-1.5">
      <dt className="text-[14px] text-muted">{label}</dt>
      <dd className={`min-w-0 truncate text-right text-[15px] font-medium text-text ${mono ? "num" : ""}`}>{value}</dd>
    </div>
  );
}

function SectionCard({
  title,
  kicker,
  onEdit,
  children,
}: {
  title: string;
  kicker: string;
  onEdit: () => void;
  children: ReactNode;
}) {
  return (
    <Card variant="interactive" chevron onClick={onEdit} ariaLabel={`Edit ${title.toLowerCase()}`}>
      <p className="telemetry mb-1">{kicker}</p>
      <h2 className="mb-2 font-display text-[26px] font-semibold uppercase leading-none tracking-[0.02em]">{title}</h2>
      <dl className="divide-y divide-hairline">{children}</dl>
    </Card>
  );
}

const CameraBadge = () => (
  <svg aria-hidden width="16" height="16" viewBox="0 0 30 30" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4.5 10.5a2 2 0 0 1 2-2h2.2l1.5-2.5h9.6l1.5 2.5h2.2a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-19a2 2 0 0 1-2-2z" />
    <circle cx="15" cy="15.5" r="4.6" />
  </svg>
);

/** Profile header + editable section cards + edit sheets. `top` renders as the first StaggerItem; `children` render below the cards (server-rendered rows). */
export function ProfileView({ user, children, top }: { user: ProfileData; children?: ReactNode; top?: ReactNode }) {
  const [open, setOpen] = useState<SheetKind | null>(null);
  const close = useCallback(() => setOpen(null), []);
  const units = user.units ?? "metric";
  const name = user.displayName ?? user.username ?? "You";
  const sex = sexSchema.safeParse(user.sex);
  const age = user.dob ? ageOn(user.dob) : NaN;
  const dash = <span className="text-dim">—</span>;

  return (
    <div className="relative isolate pb-6">
      <AmbientGlow color={SIGNAL.strain} intensity={0.55} />

      <header className="pt-safe px-safe">
        <div className="flex flex-col items-center px-5 pb-7 pt-8 text-center">
          <motion.button
            type="button"
            onClick={() => setOpen("avatar")}
            aria-label="Edit avatar"
            whileTap={{ scale: 0.96 }}
            transition={spring.press}
            className="relative rounded-full"
          >
            <Avatar
              user={{ ...user, avatarUrl: user.avatarKind ? null : `/api/avatar/${user.id}` }}
              label={name} size={116} ring={SIGNAL.strain} alt={`${name}'s avatar`} />
            <span
              aria-hidden
              className="absolute -bottom-1 -right-1 grid size-9 place-items-center rounded-full bg-white text-bg shadow-[0_0_0_3px_var(--bg),0_4px_14px_rgb(0_0_0/0.5)]"
            >
              <CameraBadge />
            </span>
          </motion.button>

          <h1 className="mt-5 max-w-full truncate font-display text-[42px] font-bold uppercase leading-[0.92] tracking-[0.02em]">
            {name}
          </h1>
          {user.username && <p className="telemetry mt-2 normal-case tracking-normal">@{user.username}</p>}
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <Badge>Member since {formatMonthYear(new Date(user.createdAt))}</Badge>
            {user.isAdmin && <Badge tone="admin">Admin</Badge>}
          </div>
        </div>
      </header>

      <Stagger className="space-y-3 px-4" delay={0.05}>
        {top && <StaggerItem>{top}</StaggerItem>}
        <StaggerItem>
          <SectionCard title="Personal" kicker="// Identity" onEdit={() => setOpen("personal")}>
            <Row label="Name" value={name} />
            <Row label="Email" value={user.email} />
            <Row label="Username" value={user.username ? `@${user.username}` : dash} />
            <Row
              label="Birthday"
              value={user.dob ? `${formatShortDate(new Date(`${user.dob}T00:00:00Z`))}${Number.isFinite(age) ? ` · ${age}` : ""}` : dash}
              mono
            />
            <Row label="Sex" value={sex.success ? SEX_LABELS[sex.data] : dash} />
          </SectionCard>
        </StaggerItem>

        <StaggerItem>
          <SectionCard title="Body" kicker="// Measurements" onEdit={() => setOpen("body")}>
            <Row label="Height" value={user.heightCm != null ? formatHeight(user.heightCm, units) : dash} mono />
            <Row label="Weight" value={user.weightKg != null ? formatWeight(user.weightKg, units) : dash} mono />
            <Row label="Max heart rate" value={user.maxHr != null ? `${user.maxHr} bpm` : "Estimated"} mono />
          </SectionCard>
        </StaggerItem>

        <StaggerItem>
          <SectionCard title="Goals" kicker="// Daily targets" onEdit={() => setOpen("goals")}>
            <Row label="Steps" value={user.stepGoal != null ? formatNumber(user.stepGoal) : dash} mono />
            <Row label="Sleep" value={user.sleepGoalMin != null ? formatSleepGoal(user.sleepGoalMin) : dash} mono />
          </SectionCard>
        </StaggerItem>

        <StaggerItem>
          <SectionCard title="Preferences" kicker="// App" onEdit={() => setOpen("preferences")}>
            <Row label="Timezone" value={user.timezone ?? dash} />
            <Row label="Units" value={units === "imperial" ? "Imperial" : "Metric"} />
          </SectionCard>
        </StaggerItem>

        <StaggerItem className="space-y-3 pt-1">{children}</StaggerItem>
      </Stagger>

      <EditSheets user={user} open={open} onClose={close} />
    </div>
  );
}
