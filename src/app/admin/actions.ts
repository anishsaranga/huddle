"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { emailDomain } from "@/lib/auth-policy";
import { getEnv } from "@/lib/env";
import { childLogger } from "@/lib/log";
import { requireAdmin } from "@/lib/session";
import { addAllowedEmail, removeAllowedEmail } from "@/lib/admin/allowlist";
import type { ActionResult } from "@/lib/admin/db";
import {
  addGroupMembers,
  createGroup,
  deleteGroup,
  removeGroupMember,
  updateGroup,
} from "@/lib/admin/groups";
import { deactivateUser, reactivateUser } from "@/lib/admin/users";
import { dryRunChampions, type ChampionsDryRun } from "@/lib/champions/admin";
import { getChampionGroup, lastCompletedWeek } from "@/lib/champions/compute";
import { postWeeklyChampions } from "@/lib/champions/post";
import { z } from "zod";

/*
 * Admin mutations. Every action re-checks the admin (server actions are plain
 * POST endpoints, so the layout's check doesn't cover them), and the DB
 * functions in src/lib/admin/* validate all input with zod. Logs carry the
 * actor id, the action and the target id (emails: domain only).
 */

const log = childLogger("admin");

const GENERIC_ERROR = "Something went wrong. Try again.";

/** Refresh every admin page. */
function refreshAdmin() {
  revalidatePath("/admin", "layout");
}

/**
 * Auth check + error boundary shared by every action. `requireAdmin()` throws
 * Next's notFound signal for non-admins; that must propagate, so it runs
 * outside the try/catch.
 */
async function withAdmin<R extends ActionResult>(
  action: string,
  fn: (actor: { id: string }) => Promise<R>,
): Promise<R> {
  const actor = await requireAdmin();
  try {
    return await fn({ id: actor.id });
  } catch (err) {
    log.error(
      { actorId: actor.id, action, err: err instanceof Error ? { name: err.name, message: err.message } : String(err) },
      "admin action failed",
    );
    return { ok: false, error: GENERIC_ERROR } as R;
  }
}

function report(
  actorId: string,
  action: string,
  result: { ok: boolean; code?: string },
  target: Record<string, unknown>,
) {
  if (result.ok) log.info({ actorId, action, ...target }, "admin action");
  else log.warn({ actorId, action, code: result.code, ...target }, "admin action rejected");
}

/* ------------------------------ Allowlist ------------------------------ */

export async function addAllowedEmailAction(email: string): Promise<ActionResult<{ email: string }>> {
  return withAdmin("allowlist.add", async (actor) => {
    const r = await addAllowedEmail(db, {
      actorId: actor.id,
      email,
      adminEmail: getEnv().ADMIN_EMAIL,
    });
    report(actor.id, "allowlist.add", r, { targetDomain: emailDomain(typeof email === "string" ? email : "") });
    if (!r.ok) return { ok: false, error: r.message };
    refreshAdmin();
    return { ok: true, email: r.email, message: "Added to the allowlist" };
  });
}

export async function removeAllowedEmailAction(email: string): Promise<ActionResult> {
  return withAdmin("allowlist.remove", async (actor) => {
    const r = await removeAllowedEmail(db, { email, adminEmail: getEnv().ADMIN_EMAIL });
    report(actor.id, "allowlist.remove", r, {
      targetDomain: emailDomain(typeof email === "string" ? email : ""),
      sessionsDeleted: r.ok ? r.sessionsDeleted : undefined,
    });
    if (!r.ok) return { ok: false, error: r.message };
    refreshAdmin();
    return { ok: true, message: "Removed from the allowlist" };
  });
}

/* ------------------------------- Groups -------------------------------- */

export async function createGroupAction(
  name: string,
  timezone: string,
): Promise<ActionResult<{ id: string }>> {
  return withAdmin("group.create", async (actor) => {
    const r = await createGroup(db, { name, timezone });
    report(actor.id, "group.create", r, { targetId: r.ok ? r.id : undefined });
    if (!r.ok) return { ok: false, error: r.message };
    refreshAdmin();
    return { ok: true, id: r.id, message: "Group created" };
  });
}

export async function updateGroupAction(
  id: string,
  name: string,
  timezone: string,
): Promise<ActionResult> {
  return withAdmin("group.update", async (actor) => {
    const r = await updateGroup(db, { id, name, timezone });
    report(actor.id, "group.update", r, { targetId: id });
    if (!r.ok) return { ok: false, error: r.message };
    refreshAdmin();
    return { ok: true, message: "Group updated" };
  });
}

export async function deleteGroupAction(id: string): Promise<ActionResult> {
  return withAdmin("group.delete", async (actor) => {
    const r = await deleteGroup(db, { id });
    report(actor.id, "group.delete", r, { targetId: id });
    if (!r.ok) return { ok: false, error: r.message };
    // Only the list: re-rendering the (now deleted) group page would 404
    // before the client navigates away.
    revalidatePath("/admin/groups");
    return { ok: true, message: "Group deleted" };
  });
}

export async function addGroupMembersAction(
  groupId: string,
  userIds: string[],
): Promise<ActionResult<{ added: number }>> {
  return withAdmin("group.addMembers", async (actor) => {
    const r = await addGroupMembers(db, { groupId, userIds });
    report(actor.id, "group.addMembers", r, { targetId: groupId, added: r.ok ? r.added : undefined });
    if (!r.ok) return { ok: false, error: r.message };
    refreshAdmin();
    return {
      ok: true,
      added: r.added,
      message: r.added === 1 ? "Added 1 member" : `Added ${r.added} members`,
    };
  });
}

export async function removeGroupMemberAction(groupId: string, userId: string): Promise<ActionResult> {
  return withAdmin("group.removeMember", async (actor) => {
    const r = await removeGroupMember(db, { groupId, userId });
    report(actor.id, "group.removeMember", r, { targetId: groupId, memberId: userId });
    if (!r.ok) return { ok: false, error: r.message };
    refreshAdmin();
    return { ok: true, message: "Removed from the group" };
  });
}

/* -------------------------------- Users -------------------------------- */

export async function deactivateUserAction(userId: string): Promise<ActionResult> {
  return withAdmin("user.deactivate", async (actor) => {
    const r = await deactivateUser(db, { actorId: actor.id, userId });
    report(actor.id, "user.deactivate", r, {
      targetId: userId,
      sessionsDeleted: r.ok ? r.sessionsDeleted : undefined,
    });
    if (!r.ok) return { ok: false, error: r.message };
    refreshAdmin();
    return { ok: true, message: "User deactivated" };
  });
}

export async function reactivateUserAction(userId: string): Promise<ActionResult> {
  return withAdmin("user.reactivate", async (actor) => {
    const r = await reactivateUser(db, { userId });
    report(actor.id, "user.reactivate", r, { targetId: userId });
    if (!r.ok) return { ok: false, error: r.message };
    refreshAdmin();
    return { ok: true, message: "User reactivated" };
  });
}

/* --------------------------- Weekly champions --------------------------- */

const GROUP_GONE = "That group doesn't exist.";
const isUuid = (v: unknown): v is string => z.uuid().safeParse(v).success;

/** Compute last week's champions for a group and generate the text, without posting. */
export async function championsDryRunAction(groupId: string): Promise<ActionResult<{ dry: ChampionsDryRun }>> {
  return withAdmin("champions.dryRun", async (actor) => {
    if (!isUuid(groupId)) return { ok: false, error: GROUP_GONE };
    const dry = await dryRunChampions(db, groupId);
    report(actor.id, "champions.dryRun", { ok: true }, {
      targetId: groupId,
      weekStart: dry.weekStart,
      outcome: dry.ok ? dry.source : dry.reason,
    });
    if (!dry.ok && dry.reason === "no_group") return { ok: false, error: GROUP_GONE };
    return { ok: true, dry };
  });
}

/** Post last week's champions now (idempotent: "Already posted" when it exists). */
export async function postChampionsNowAction(
  groupId: string,
): Promise<ActionResult<{ status: "posted" | "already_posted" }>> {
  return withAdmin("champions.post", async (actor) => {
    if (!isUuid(groupId)) return { ok: false, error: GROUP_GONE };
    const group = await getChampionGroup(db, groupId);
    if (!group) return { ok: false, error: GROUP_GONE };
    const r = await postWeeklyChampions(db, groupId, lastCompletedWeek(group.timezone, new Date()));
    report(actor.id, "champions.post", { ok: r.status !== "skipped" }, { targetId: groupId, weekStart: r.weekStart, status: r.status });
    if (r.status === "skipped") return { ok: false, error: "Not enough data: fewer than 2 members have 4+ days last week." };
    refreshAdmin();
    revalidatePath(`/groups/${groupId}`);
    return r.status === "posted"
      ? { ok: true, status: "posted", message: "Champions posted to the group chat" }
      : { ok: true, status: "already_posted", message: "Already posted for that week" };
  });
}
