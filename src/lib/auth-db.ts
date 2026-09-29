import { eq, sql } from "drizzle-orm";
import { db as defaultDb } from "@/db";
import { allowedEmails, users } from "@/db/schema";
import { normalizeEmail } from "@/lib/auth-policy";

type Db = typeof defaultDb;

/** DB facts the sign-in policy needs for one email. */
export async function loadSignInFacts(
  email: string,
  db: Db = defaultDb,
): Promise<{ isAllowlisted: boolean; deactivated: boolean }> {
  const e = normalizeEmail(email);
  if (!e) return { isAllowlisted: false, deactivated: false };
  const [allowed, user] = await Promise.all([
    db.select({ email: allowedEmails.email }).from(allowedEmails).where(eq(allowedEmails.email, e)).limit(1),
    db.select({ deactivatedAt: users.deactivatedAt }).from(users).where(eq(users.email, e)).limit(1),
  ]);
  return { isAllowlisted: allowed.length > 0, deactivated: !!user[0]?.deactivatedAt };
}

/**
 * Make `is_admin` true for exactly the ADMIN_EMAIL account and false for
 * everyone else. Runs on every sign-in, so changing ADMIN_EMAIL also demotes
 * the previous admin. Returns the number of rows changed.
 */
export async function enforceAdminFlags(
  adminEmail: string | null | undefined,
  db: Db = defaultDb,
): Promise<number> {
  const admin = normalizeEmail(adminEmail) ?? "";
  const changed = await db
    .update(users)
    .set({ isAdmin: sql`(${users.email} = ${admin})` })
    .where(sql`${users.isAdmin} is distinct from (${users.email} = ${admin})`)
    .returning({ id: users.id });
  return changed.length;
}
