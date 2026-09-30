import { notFound } from "next/navigation";
import { db } from "@/db";
import { GroupChat } from "@/components/chat/GroupChat";
import { GroupHeader } from "@/components/groups/GroupHeader";
import { GroupScreen } from "@/components/groups/GroupScreen";
import { InfoPanel } from "@/components/groups/InfoPanel";
import { avatarUserOf, fullName } from "@/components/groups/metric";
import type { GroupTrendBar, MemberView } from "@/components/groups/types";
import { dateLabel, shortDate, weekdayShort } from "@/lib/dashboard/dates";
import { getActiveFlair } from "@/lib/champions/flair";
import { listMessages } from "@/lib/chat/service";
import { memberGroup } from "@/lib/groups/access";
import { getGroupFirstScoreDate, getGroupRecoveryTrend, getMembersToday, groupDateOf } from "@/lib/groups/queries";
import { groupDateContext, groupToday, parseGroupState } from "@/lib/groups/view";
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
  // The group's today (its own timezone, not the viewer's) drives the Info tab, the trend and the board defaults.
  const today = groupDateOf(group, now);
  const [membersByGroup, firstDate, trend, chatPage, sp] = await Promise.all([
    getMembersToday(db, [group], now),
    getGroupFirstScoreDate(db, group.id),
    getGroupRecoveryTrend(db, group.id, today, 7),
    listMessages(db, group.id, user.id),
    searchParams,
  ]);
  // Chat times and day separators use the viewer's own timezone.
  const chatTz = user.timezone || group.timezone || "UTC";
  const state = parseGroupState(sp, today, firstDate);
  const members = membersByGroup.get(group.id) ?? [];
  const [boards, flair] = await Promise.all([
    getGroupBoards(db, group.id, state.period, state.date),
    // Trophy flair for the group's current weekly champions (Info rows, boards, chat avatars).
    getActiveFlair(db, members.map((m) => m.userId), group.id, now),
  ]);

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
    hasData: m.hasData,
    lastSynced: m.lastSyncAt ? formatRelative(m.lastSyncAt, now) : null,
    todayLabel: dateLabel(m.date, m.date),
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
      flair={flair}
      header={
        <GroupHeader
          name={group.name}
          timezone={group.timezone}
          memberCount={members.length}
          people={members.map((m) => ({ id: m.userId, label: fullName(m), user: avatarUserOf(m) }))}
        />
      }
      info={<InfoPanel members={memberViews} today={summary} trend={trendBars} trendAvg={trendAvg} viewerId={user.id} dateContext={groupDateContext(today, group.timezone)} />}
      chat={
        <GroupChat
          groupId={group.id}
          groupName={group.name}
          viewer={{
            id: user.id,
            displayName: user.displayName,
            username: user.username,
            avatarKind: user.avatarKind,
            avatarConfig: user.avatarConfig,
            avatarPath: user.avatarPath,
          }}
          tz={chatTz}
          today={todayIn(chatTz, now)}
          initial={chatPage ?? { messages: [], hasMore: false }}
        />
      }
    />
  );
}
