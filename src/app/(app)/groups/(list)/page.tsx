import { db } from "@/db";
import { PageHeader } from "@/components/PageHeader";
import { avatarUserOf, fullName } from "@/components/groups/metric";
import { GroupCard } from "@/components/groups/GroupCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { Stagger, StaggerItem } from "@/components/ui/Stagger";
import { listMemberGroups } from "@/lib/groups/queries";
import { requireOnboardedUser } from "@/lib/session";

export const metadata = { title: "Community" };

export default async function CommunityPage() {
  const user = await requireOnboardedUser();
  const groups = await listMemberGroups(db, user.id);

  return (
    <>
      <PageHeader title="Community" subtitle={groups.length === 1 ? "Your group" : "Your groups"} />
      {groups.length === 0 ? (
        <div className="px-4">
          <EmptyState title="No groups yet">You&apos;re not in a group yet — ask the admin to add you.</EmptyState>
        </div>
      ) : (
        <Stagger className="space-y-3 px-4" delay={0.04} stagger={0.08}>
          {groups.map((g, i) => (
            <StaggerItem key={g.id}>
              <GroupCard
                id={g.id}
                name={g.name}
                timezone={g.timezone}
                memberCount={g.members.length}
                people={g.members.map((m) => ({ id: m.userId, label: fullName(m), user: avatarUserOf(m) }))}
                today={g.today}
                delay={0.15 + i * 0.08}
              />
            </StaggerItem>
          ))}
        </Stagger>
      )}
    </>
  );
}
