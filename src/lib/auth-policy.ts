/**
 * Pure sign-in policy. No I/O, so it is trivially unit-testable; the Auth.js
 * signIn callback (lib/auth.ts) gathers the facts and calls this.
 */

/** Canonical form for every stored/compared email. */
export function normalizeEmail(email: string | null | undefined): string | null {
  const e = email?.trim().toLowerCase();
  return e ? e : null;
}

/** Domain part only, safe to log. */
export function emailDomain(email: string | null | undefined): string | undefined {
  const e = normalizeEmail(email);
  return e?.includes("@") ? e.slice(e.lastIndexOf("@") + 1) : undefined;
}

export type SignInFacts = {
  email: string | null | undefined;
  /** Google's `email_verified` claim. Anything but `true` is treated as unverified. */
  emailVerified: boolean | null | undefined;
  /** ADMIN_EMAIL from env; may be unset. */
  adminEmail: string | null | undefined;
  isAllowlisted: boolean;
  /** Whether an existing user row with this email is deactivated. */
  deactivated: boolean;
};

export type SignInDenyReason = "no_email" | "unverified" | "not_allowlisted" | "deactivated";

export type SignInDecision =
  | { allowed: true; isAdmin: boolean; email: string }
  | { allowed: false; isAdmin: false; reason: SignInDenyReason };

/** True iff `email` is the configured admin (case-insensitive). */
export function isAdminEmail(
  email: string | null | undefined,
  adminEmail: string | null | undefined,
): boolean {
  const e = normalizeEmail(email);
  const a = normalizeEmail(adminEmail);
  return e !== null && a !== null && e === a;
}

/**
 * Allowed iff the Google email is verified AND
 *   (email == ADMIN_EMAIL) OR (email is allowlisted AND not deactivated).
 * The admin is always allowed and always admin; nobody else is ever admin.
 */
export function decideSignIn(facts: SignInFacts): SignInDecision {
  const email = normalizeEmail(facts.email);
  if (!email) return { allowed: false, isAdmin: false, reason: "no_email" };
  if (facts.emailVerified !== true) return { allowed: false, isAdmin: false, reason: "unverified" };

  if (isAdminEmail(email, facts.adminEmail)) return { allowed: true, isAdmin: true, email };

  if (!facts.isAllowlisted) return { allowed: false, isAdmin: false, reason: "not_allowlisted" };
  if (facts.deactivated) return { allowed: false, isAdmin: false, reason: "deactivated" };
  return { allowed: true, isAdmin: false, email };
}
