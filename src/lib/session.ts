import "server-only";
import { eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { db } from "@/db";
import { users, type User } from "@/db/schema";
import { auth, LOGIN_PATH } from "@/lib/auth";

export const ONBOARDING_PATH = "/onboarding";

/**
 * The signed-in user, read fresh from the DB (deduped per request).
 * Returns null when signed out or when the account is deactivated.
 * `auth()` also refreshes the session's expiry, so always go through it.
 */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!user || user.deactivatedAt) return null;
  return user;
});

/** Signed-in user or redirect to /login. */
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect(LOGIN_PATH);
  return user;
}

/** Signed-in, onboarded user; otherwise /login or /onboarding. */
export async function requireOnboardedUser(): Promise<User> {
  const user = await requireUser();
  if (!user.onboardedAt) redirect(ONBOARDING_PATH);
  return user;
}

/** The admin, or a 404 for everyone else (the admin area is not advertised). */
export async function requireAdmin(): Promise<User> {
  const user = await getCurrentUser();
  if (!user?.isAdmin) notFound();
  return user;
}
