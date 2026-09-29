import { notFound } from "next/navigation";
import { db } from "@/db";
import { ChatPlaceholder } from "@/components/groups/ChatPlaceholder";
import { GroupHeader } from "@/components/groups/GroupHeader";
import { GroupScreen } from "@/components/groups/GroupScreen";
import { InfoPanel } from "@/components/groups/InfoPanel";
import { avatarUserOf, fullName } from "@/components/groups/metric";
import type { GroupTrendBar, MemberView } from "@/components/groups/types";
import { dateLabel, shortDate, weekdayShort } from "@/lib/dashboard/dates";
import { memberGroup } from "@/lib/groups/access";
import { getGroupFirstScoreDate, getGroupRecoveryTrend, getMembersToday } from "@/lib/groups/queries";
import { groupToday, parseGroupState } from "@/lib/groups/view";
import { getGroupBoards } from "@/lib/scores/queries";
import { requireOnboardedUser } from "@/lib/session";
import { todayIn } from "@/lib/tz";
import { recoveryColor, recoveryColorOrNeutral } from "@/lib/ui/colors";
import { formatRelative } from "@/lib/ui/format";

export const metadata = { title: "Group" };

export default async function GroupPage({ params, searchParams }: PageProps<"/groups/[id]">) {
  const user = await requireOnboardedUser();
  const { id } = await params;
  // Members only (admins included): anyone else gets the same 404 as a missing group.
  // The layout already checked (deduped); repeated because layouts don't re-run on client navigation.
  const group = await memberGroup(id, user.id);
  if (!group) notFound();

  const now = new Date();
  const today = todayIn(user.timezone || "UTC", now);
  const [membersByGroup, firstDate, trend, sp] = await Promise.all([
    getMembersToday(db, [group.id], now),
    getGroupFirstScoreDate(db, group.id),
    getGroupRecoveryTrend(db, group.id, today, 7),
    searchParams,
  ]);
  const state = parseGroupState(sp, today, firstDate);
  const boards = await getGroupBoards(db, group.id, state.period, state.date);

  const members = membersByGroup.get(group.id) ?? [];
  const summary = groupToday(members);
  const memberViews: MemberView[] = members.map((m) => ({
    userId: m.userId,
    username: m.username,
    displayName: m.displayName,
    avatarKind: m.avatarKind,
    avatarConfig: m.avatarConfig,
    avatarPath: m.avatarPath,
    timezone: m.timezone,
    scores: m.scores,
    syncedToday: m.syncedToday,
    lastSynced: m.lastSyncAt ? formatRelative(m.lastSyncAt, now) : null,
    todayLabel: dateLabel(m.today, m.today),
  }));
  const trendBars: GroupTrendBar[] = trend.map((p) => ({
    label: p.date === today ? "TODAY" : weekdayShort(p.date),
    title: `${weekdayShort(p.date)} · ${shortDate(p.date)}`,
    value: p.value,
    color: p.value !== null ? recoveryColor(p.value) : undefined,
  }));
  const withValue = trend.filter((p) => p.value !== null);
  const trendAvg = withValue.length ? withValue.reduce((a, p) => a + p.value!, 0) / withValue.length : null;

  return (
    <GroupScreen
      groupId={group.id}
      today={today}
      firstDate={firstDate}
      viewerId={user.id}
      state={state}
      boards={boards}
      infoGlow={recoveryColorOrNeutral(summary.recovery.value)}
      header={
        <GroupHeader
          name={group.name}
          timezone={group.timezone}
          memberCount={members.length}
          people={members.map((m) => ({ id: m.userId, label: fullName(m), user: avatarUserOf(m) }))}
        />
      }
      info={<InfoPanel members={memberViews} today={summary} trend={trendBars} trendAvg={trendAvg} viewerId={user.id} />}
      chat={<ChatPlaceholder />}
    />
  );
}
