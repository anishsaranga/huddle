"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AvatarStack } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Sheet } from "@/components/ui/Sheet";
import { Stagger, StaggerItem } from "@/components/ui/Stagger";
import type { GroupSummary } from "@/lib/admin/groups";
import { runtimeTimezone } from "@/lib/admin/timezones";
import { createGroupAction } from "../actions";
import { GroupForm } from "./GroupForm";
import { PlusIcon } from "./IconButton";
import { SectionHeader } from "./SectionHeader";
import { useAdminAction } from "./useAdminAction";

type GroupsManagerProps = {
  groups: GroupSummary[];
  /** The admin's saved timezone, if any (falls back to the browser's, then UTC). */
  adminTimezone: string | null;
};

export function GroupsManager({ groups, adminTimezone }: GroupsManagerProps) {
  const router = useRouter();
  const { run, pending } = useAdminAction();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const newButton = (
    <Button size="md" icon={<PlusIcon />} onClick={() => setOpen(true)}>
      New
    </Button>
  );

  return (
    <>
      <SectionHeader kicker="Admin" title="Groups" action={groups.length > 0 ? newButton : undefined}>
        Groups share a leaderboard, chat and a timezone. People can be in several.
      </SectionHeader>

      {groups.length === 0 ? (
        <EmptyState title="No groups yet" action={newButton}>
          Create the first one, then add people from the allowlist.
        </EmptyState>
      ) : (
        <Stagger className="space-y-2">
          {groups.map((g) => (
            <StaggerItem key={g.id}>
              <Card variant="interactive" href={`/admin/groups/${g.id}`} chevron padding="p-4">
                <p className="truncate font-display text-[26px] font-semibold uppercase leading-none tracking-[0.02em]">
                  {g.name}
                </p>
                <p className="telemetry mt-2">{g.timezone.replaceAll("_", " ")}</p>
                <div className="mt-3 flex items-center gap-3">
                  {g.members.length > 0 && <AvatarStack people={g.members} total={g.memberCount} />}
                  <span className="telemetry num">
                    {g.memberCount} {g.memberCount === 1 ? "member" : "members"}
                  </span>
                </div>
              </Card>
            </StaggerItem>
          ))}
        </Stagger>
      )}

      <Sheet open={open} onClose={() => setOpen(false)} title="New group">
        <GroupForm
          initial={{ name: "", timezone: adminTimezone ?? runtimeTimezone() }}
          submitLabel="Create group"
          pending={pending}
          error={error}
          onClearError={() => setError(null)}
          onSubmit={({ name, timezone }) =>
            run(() => createGroupAction(name, timezone), {
              onSuccess: (r) => {
                setOpen(false);
                router.push(`/admin/groups/${r.id}`);
              },
              onError: setError,
            })
          }
        />
      </Sheet>
    </>
  );
}
