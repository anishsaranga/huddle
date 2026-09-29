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
