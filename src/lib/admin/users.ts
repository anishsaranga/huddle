import { and, asc, eq, isNull } from "drizzle-orm";
import { users } from "@/db/schema";
import { fail, type Db, type Result } from "./db";
import { onUserDeactivated } from "./lifecycle";
import { firstIssue, idSchema } from "./schemas";

export type UserStatus = "active" | "deactivated" | "not_onboarded";

export type AdminUserRow = {
  id: string;
  email: string;
  displayName: string | null;
  username: string | null;
  isAdmin: boolean;
  status: UserStatus;
  onboarded: boolean;
  createdAt: Date;
};

export function userStatus(u: { deactivatedAt: Date | null; onboardedAt: Date | null }): UserStatus {
  if (u.deactivatedAt) return "deactivated";
  if (!u.onboardedAt) return "not_onboarded";
  return "active";
}

/** Every user, oldest first. */
export async function listAdminUsers(db: Db): Promise<AdminUserRow[]> {
  const rows = await db.select().from(users).orderBy(asc(users.createdAt));
  return rows.map((u) => ({
    id: u.id,
    email: u.email,
    displayName: u.displayName ?? u.name,
    username: u.username,
    isAdmin: u.isAdmin,
    status: userStatus(u),
    onboarded: u.onboardedAt !== null,
    createdAt: u.createdAt,
  }));
}

type DeactivateCode = "invalid" | "self" | "admin" | "not_found";

/** Set `deactivated_at` and end their sessions. The admin can't deactivate themself (or any admin). */
export async function deactivateUser(
  db: Db,
  input: { actorId: string; userId: unknown },
): Promise<Result<{ sessionsDeleted: number }, DeactivateCode>> {
  const parsed = idSchema.safeParse(input.userId);
  if (!parsed.success) return fail("invalid", firstIssue(parsed.error));
  const userId = parsed.data;

  if (userId === input.actorId) return fail("self", "You can't deactivate yourself.");

  return db.transaction(async (tx) => {
    const [target] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!target) return fail("not_found", "That user doesn't exist.");
    if (target.isAdmin) return fail("admin", "The admin can't be deactivated.");

    await tx
      .update(users)
      .set({ deactivatedAt: new Date() })
      .where(and(eq(users.id, userId), isNull(users.deactivatedAt)));
    // Also runs when already deactivated, so leftover sessions never survive.
    const { sessionsDeleted } = await onUserDeactivated(userId, tx);
    return { ok: true as const, sessionsDeleted };
  });
}

type ReactivateCode = "invalid" | "not_found";

export async function reactivateUser(
  db: Db,
  input: { userId: unknown },
): Promise<Result<object, ReactivateCode>> {
  const parsed = idSchema.safeParse(input.userId);
  if (!parsed.success) return fail("invalid", firstIssue(parsed.error));
  const updated = await db
    .update(users)
    .set({ deactivatedAt: null })
    .where(eq(users.id, parsed.data))
    .returning({ id: users.id });
  if (updated.length === 0) return fail("not_found", "That user doesn't exist.");
  return { ok: true };
}
