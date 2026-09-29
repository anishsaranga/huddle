import { and, asc, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { groupMembers, groups, users } from "@/db/schema";
import { fail, type Db, type Result } from "./db";
import { firstIssue, groupNameSchema, idListSchema, idSchema, timezoneSchema } from "./schemas";
import { userStatus, type UserStatus } from "./users";

/** Just enough of a person to draw an avatar (real avatars arrive in M2). */
export type MemberPreview = { id: string; label: string };

export type GroupSummary = {
  id: string;
  name: string;
  timezone: string;
  memberCount: number;
  /** First few members, for the avatar stack. */
  members: MemberPreview[];
};

const PREVIEW_LIMIT = 4;

/**
 * Members added together (one INSERT, or one transaction) share the same
 * joined_at, so joined_at alone is not a total order. Break ties by the label
 * shown in the UI, then id, so listings are stable.
 */
const memberOrder = () => [
  asc(groupMembers.joinedAt),
  asc(sql`coalesce(${users.displayName}, ${users.name}, ${users.username}, ${users.email})`),
  asc(users.id),
];

const labelOf = (u: {
  displayName: string | null;
  name: string | null;
  username: string | null;
  email: string;
}) => u.displayName ?? u.name ?? u.username ?? u.email;

export async function listGroups(db: Db): Promise<GroupSummary[]> {
  const rows = await db.select().from(groups).orderBy(asc(groups.createdAt), asc(groups.name));
  if (rows.length === 0) return [];

  const members = await db
    .select({
      groupId: groupMembers.groupId,
      id: users.id,
      displayName: users.displayName,
      name: users.name,
      username: users.username,
      email: users.email,
    })
    .from(groupMembers)
    .innerJoin(users, eq(users.id, groupMembers.userId))
    .orderBy(...memberOrder());

  const byGroup = new Map<string, MemberPreview[]>();
  const counts = new Map<string, number>();
  for (const m of members) {
    counts.set(m.groupId, (counts.get(m.groupId) ?? 0) + 1);
    const list = byGroup.get(m.groupId) ?? [];
    if (list.length < PREVIEW_LIMIT) list.push({ id: m.id, label: labelOf(m) });
    byGroup.set(m.groupId, list);
  }

  return rows.map((g) => ({
    id: g.id,
    name: g.name,
    timezone: g.timezone,
    memberCount: counts.get(g.id) ?? 0,
    members: byGroup.get(g.id) ?? [],
  }));
}

export type GroupMemberRow = {
  id: string;
  label: string;
  email: string;
  username: string | null;
  status: UserStatus;
  joinedAt: Date;
};

export type AddableUser = { id: string; label: string; email: string; username: string | null };

export type GroupDetail = {
  group: { id: string; name: string; timezone: string };
  members: GroupMemberRow[];
  /** Active users who aren't in the group yet. */
  addable: AddableUser[];
};

/** null when the id is malformed or the group doesn't exist. */
export async function getGroupDetail(db: Db, groupId: string): Promise<GroupDetail | null> {
  if (!idSchema.safeParse(groupId).success) return null;
  const [group] = await db.select().from(groups).where(eq(groups.id, groupId)).limit(1);
  if (!group) return null;

  const members = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      name: users.name,
      username: users.username,
      email: users.email,
      deactivatedAt: users.deactivatedAt,
      onboardedAt: users.onboardedAt,
      joinedAt: groupMembers.joinedAt,
    })
    .from(groupMembers)
    .innerJoin(users, eq(users.id, groupMembers.userId))
    .where(eq(groupMembers.groupId, groupId))
    .orderBy(...memberOrder());

  const memberIds = members.map((m) => m.id);
  const others = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      name: users.name,
      username: users.username,
      email: users.email,
    })
    .from(users)
    .where(
      and(isNull(users.deactivatedAt), memberIds.length ? notInArray(users.id, memberIds) : undefined),
    )
    .orderBy(asc(users.createdAt), asc(users.id));

  return {
    group: { id: group.id, name: group.name, timezone: group.timezone },
    members: members.map((m) => ({
      id: m.id,
      label: labelOf(m),
      email: m.email,
      username: m.username,
      status: userStatus(m),
      joinedAt: m.joinedAt,
    })),
    addable: others.map((u) => ({
      id: u.id,
      label: labelOf(u),
      email: u.email,
      username: u.username,
    })),
  };
}

type GroupCode = "invalid" | "not_found";

export async function createGroup(
  db: Db,
  input: { name: unknown; timezone: unknown },
): Promise<Result<{ id: string }, "invalid">> {
  const name = groupNameSchema.safeParse(input.name);
  if (!name.success) return fail("invalid", firstIssue(name.error));
  const tz = timezoneSchema.safeParse(input.timezone);
  if (!tz.success) return fail("invalid", firstIssue(tz.error));

  const [row] = await db
    .insert(groups)
    .values({ name: name.data, timezone: tz.data })
    .returning({ id: groups.id });
  return { ok: true, id: row.id };
}

/** Rename and/or change timezone. */
export async function updateGroup(
  db: Db,
  input: { id: unknown; name?: unknown; timezone?: unknown },
): Promise<Result<object, GroupCode>> {
  const id = idSchema.safeParse(input.id);
  if (!id.success) return fail("invalid", firstIssue(id.error));

  const patch: Partial<typeof groups.$inferInsert> = {};
  if (input.name !== undefined) {
    const name = groupNameSchema.safeParse(input.name);
    if (!name.success) return fail("invalid", firstIssue(name.error));
    patch.name = name.data;
  }
  if (input.timezone !== undefined) {
    const tz = timezoneSchema.safeParse(input.timezone);
    if (!tz.success) return fail("invalid", firstIssue(tz.error));
    patch.timezone = tz.data;
  }
  if (Object.keys(patch).length === 0) return fail("invalid", "Nothing to change.");

  const updated = await db
    .update(groups)
    .set(patch)
    .where(eq(groups.id, id.data))
    .returning({ id: groups.id });
  if (updated.length === 0) return fail("not_found", "That group doesn't exist.");
  return { ok: true };
}

/** Deletes the group; memberships cascade. Users are untouched. */
export async function deleteGroup(db: Db, input: { id: unknown }): Promise<Result<object, GroupCode>> {
  const id = idSchema.safeParse(input.id);
  if (!id.success) return fail("invalid", firstIssue(id.error));
  const deleted = await db.delete(groups).where(eq(groups.id, id.data)).returning({ id: groups.id });
  if (deleted.length === 0) return fail("not_found", "That group doesn't exist.");
  return { ok: true };
}

/** Add users to a group. Already-members are skipped; unknown or deactivated users are ignored. */
export async function addGroupMembers(
  db: Db,
  input: { groupId: unknown; userIds: unknown },
): Promise<Result<{ added: number }, GroupCode>> {
  const groupId = idSchema.safeParse(input.groupId);
  if (!groupId.success) return fail("invalid", firstIssue(groupId.error));
  const userIds = idListSchema.safeParse(input.userIds);
  if (!userIds.success) return fail("invalid", firstIssue(userIds.error));

  return db.transaction(async (tx) => {
    const [group] = await tx.select({ id: groups.id }).from(groups).where(eq(groups.id, groupId.data));
    if (!group) return fail("not_found", "That group doesn't exist.");

    const eligible = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(inArray(users.id, [...new Set(userIds.data)]), isNull(users.deactivatedAt)));
    if (eligible.length === 0) return { ok: true as const, added: 0 };

    const inserted = await tx
      .insert(groupMembers)
      .values(eligible.map((u) => ({ groupId: groupId.data, userId: u.id })))
      .onConflictDoNothing()
      .returning({ userId: groupMembers.userId });
    return { ok: true as const, added: inserted.length };
  });
}

export async function removeGroupMember(
  db: Db,
  input: { groupId: unknown; userId: unknown },
): Promise<Result<object, GroupCode>> {
  const groupId = idSchema.safeParse(input.groupId);
  if (!groupId.success) return fail("invalid", firstIssue(groupId.error));
  const userId = idSchema.safeParse(input.userId);
  if (!userId.success) return fail("invalid", firstIssue(userId.error));

  const removed = await db
    .delete(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId.data), eq(groupMembers.userId, userId.data)))
    .returning({ userId: groupMembers.userId });
  if (removed.length === 0) return fail("not_found", "They aren't in that group.");
  return { ok: true };
}

/** Member count for a group (used by tests). */
export async function countMembers(db: Db, groupId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(groupMembers)
    .where(eq(groupMembers.groupId, groupId));
  return row?.n ?? 0;
}
