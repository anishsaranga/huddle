import { asc, eq, inArray } from "drizzle-orm";
import { allowedEmails, sessions, users } from "@/db/schema";
import { isAdminEmail, normalizeEmail } from "@/lib/auth-policy";
import { fail, type Db, type Result } from "./db";
import { emailSchema, firstIssue } from "./schemas";

export type AllowlistEntry = {
  email: string;
  /** ADMIN_EMAIL: always allowed, cannot be removed. */
  pinned: boolean;
  addedAt: Date | null;
  /** Present once that person has signed in. */
  user: { id: string; displayName: string | null; deactivated: boolean } | null;
};

/** Allowlisted emails (oldest first) with the admin pinned on top. */
export async function listAllowlist(
  db: Db,
  adminEmail: string | null | undefined,
): Promise<AllowlistEntry[]> {
  const rows = await db.select().from(allowedEmails).orderBy(asc(allowedEmails.createdAt));
  const admin = normalizeEmail(adminEmail);
  const others = rows.filter((r) => r.email !== admin);

  const emails = [...others.map((r) => r.email), ...(admin ? [admin] : [])];
  const people = emails.length
    ? await db
        .select({
          id: users.id,
          email: users.email,
          displayName: users.displayName,
          name: users.name,
          username: users.username,
          deactivatedAt: users.deactivatedAt,
        })
        .from(users)
        .where(inArray(users.email, emails))
    : [];
  const byEmail = new Map(people.map((p) => [p.email, p]));

  const toUser = (email: string): AllowlistEntry["user"] => {
    const p = byEmail.get(email);
    return p
      ? {
          id: p.id,
          displayName: p.displayName ?? p.name ?? p.username,
          deactivated: p.deactivatedAt !== null,
        }
      : null;
  };

  const entries: AllowlistEntry[] = others.map((r) => ({
    email: r.email,
    pinned: false,
    addedAt: r.createdAt,
    user: toUser(r.email),
  }));
  if (admin) {
    const own = rows.find((r) => r.email === admin);
    entries.unshift({
      email: admin,
      pinned: true,
      addedAt: own?.createdAt ?? null,
      user: toUser(admin),
    });
  }
  return entries;
}

type AddCode = "invalid" | "admin_email" | "duplicate";

export async function addAllowedEmail(
  db: Db,
  input: { actorId: string; email: unknown; adminEmail: string | null | undefined },
): Promise<Result<{ email: string }, AddCode>> {
  const parsed = emailSchema.safeParse(input.email);
  if (!parsed.success) return fail("invalid", firstIssue(parsed.error));
  const email = parsed.data;

  if (isAdminEmail(email, input.adminEmail)) {
    return fail("admin_email", "That's the admin address. It's always allowed.");
  }

  const inserted = await db
    .insert(allowedEmails)
    .values({ email, addedBy: input.actorId })
    .onConflictDoNothing()
    .returning({ email: allowedEmails.email });
  if (inserted.length === 0) return fail("duplicate", "That email is already on the list.");
  return { ok: true, email };
}

type RemoveCode = "invalid" | "admin_email" | "not_found";

/**
 * Remove an email from the allowlist. The user row (if any) stays, but they
 * can't sign in again, and their existing sessions are deleted so they are
 * signed out now.
 */
export async function removeAllowedEmail(
  db: Db,
  input: { email: unknown; adminEmail: string | null | undefined },
): Promise<Result<{ email: string; sessionsDeleted: number }, RemoveCode>> {
  const parsed = emailSchema.safeParse(input.email);
  if (!parsed.success) return fail("invalid", firstIssue(parsed.error));
  const email = parsed.data;

  if (isAdminEmail(email, input.adminEmail)) {
    return fail("admin_email", "The admin can't be removed. That address is always allowed.");
  }

  return db.transaction(async (tx) => {
    const removed = await tx
      .delete(allowedEmails)
      .where(eq(allowedEmails.email, email))
      .returning({ email: allowedEmails.email });
    if (removed.length === 0) return fail("not_found", "That email isn't on the list.");

    const [user] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    const gone = user
      ? await tx
          .delete(sessions)
          .where(eq(sessions.userId, user.id))
          .returning({ t: sessions.sessionToken })
      : [];
    return { ok: true as const, email, sessionsDeleted: gone.length };
  });
}
