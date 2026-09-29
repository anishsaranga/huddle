import { DrizzleAdapter } from "@auth/drizzle-adapter";
import NextAuth, { type DefaultSession, type NextAuthConfig } from "next-auth";
import type { Adapter } from "next-auth/adapters";
import Google from "next-auth/providers/google";
import { getDb } from "@/db";
import { accounts, sessions, users, verificationTokens, type User } from "@/db/schema";
import { enforceAdminFlags, loadSignInFacts } from "@/lib/auth-db";
import { decideSignIn, emailDomain, normalizeEmail } from "@/lib/auth-policy";
import { childLogger } from "@/lib/log";

const log = childLogger("auth");

/** What pages and components see as `session.user`. */
export type SessionUser = {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  username: string | null;
  displayName: string | null;
  isAdmin: boolean;
  onboarded: boolean;
  avatarKind: User["avatarKind"];
  avatarConfig: User["avatarConfig"];
  avatarPath: string | null;
};

declare module "next-auth" {
  interface Session {
    user: SessionUser & DefaultSession["user"];
  }
}

export const DENIED_PATH = "/denied";
export const LOGIN_PATH = "/login";

/** Whether the Google OAuth client is configured (the login action checks this first). */
export function isGoogleConfigured(): boolean {
  return !!process.env.AUTH_GOOGLE_ID && !!process.env.AUTH_GOOGLE_SECRET;
}

/** Auth.js adapter with emails normalized to lowercase on the way in. */
function createAdapter(): Adapter {
  const base = DrizzleAdapter(getDb(), {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  });
  return {
    ...base,
    createUser: (data) => base.createUser!({ ...data, email: normalizeEmail(data.email) ?? data.email }),
    getUserByEmail: (email) => base.getUserByEmail!(normalizeEmail(email) ?? email),
  };
}

function toSessionUser(u: User): SessionUser {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    image: u.image,
    username: u.username,
    displayName: u.displayName,
    isAdmin: u.isAdmin,
    onboarded: u.onboardedAt !== null,
    avatarKind: u.avatarKind,
    avatarConfig: u.avatarConfig,
    avatarPath: u.avatarPath,
  };
}

function buildConfig(): NextAuthConfig {
  return {
    adapter: createAdapter(),
    session: { strategy: "database" },
    // Behind the cloudflared tunnel the Host header is the public hostname.
    trustHost: true,
    // Cookies are SameSite=Lax (Auth.js default); `__Secure-` + Secure in production.
    useSecureCookies: process.env.NODE_ENV === "production",
    // Full-page redirects only (no popups): works in iOS standalone PWAs.
    pages: { signIn: LOGIN_PATH, error: LOGIN_PATH },
    providers: [
      Google({
        // Google-only and `email_verified` is required below, so linking a
        // Google account to an existing row with the same email is safe.
        allowDangerousEmailAccountLinking: true,
        profile(p) {
          return {
            id: p.sub,
            name: p.name,
            email: normalizeEmail(p.email) ?? p.email,
            image: p.picture,
          };
        },
      }),
    ],
    callbacks: {
      async signIn({ account, profile }) {
        if (account?.provider !== "google") {
          log.warn({ provider: account?.provider }, "sign-in denied: unsupported provider");
          return DENIED_PATH;
        }
        const email = normalizeEmail(profile?.email);
        const facts = email
          ? await loadSignInFacts(email)
          : { isAllowlisted: false, deactivated: false };
        const decision = decideSignIn({
          email,
          emailVerified: profile?.email_verified as boolean | undefined,
          adminEmail: process.env.ADMIN_EMAIL,
          ...facts,
        });
        if (!decision.allowed) {
          log.info({ domain: emailDomain(email), reason: decision.reason }, "sign-in denied");
          return DENIED_PATH;
        }
        log.info({ domain: emailDomain(email), admin: decision.isAdmin }, "sign-in allowed");
        return true;
      },
      session({ session, user }) {
        // Database strategy: `user` is the full users row, read fresh per request.
        return { ...session, user: { ...session.user, ...toSessionUser(user as unknown as User) } };
      },
    },
    events: {
      async signIn({ user, isNewUser }) {
        const changed = await enforceAdminFlags(process.env.ADMIN_EMAIL);
        log.info({ userId: user.id, isNewUser: !!isNewUser, adminFlagsChanged: changed }, "signed in");
      },
      createUser({ user }) {
        log.info({ userId: user.id, domain: emailDomain(user.email) }, "user created");
      },
      signOut(message) {
        const userId = "session" in message ? message.session?.userId : undefined;
        log.info({ userId }, "signed out");
      },
    },
    // Route Auth.js' own logs through pino. Debug output can contain tokens,
    // so it is dropped; errors are logged by name/message only.
    logger: {
      error(error) {
        const cause = (error as Error & { cause?: unknown }).cause;
        log.error(
          {
            err: { name: error.name, message: error.message },
            cause: cause instanceof Error ? { name: cause.name, message: cause.message } : undefined,
          },
          "auth.js error",
        );
      },
      warn(code) {
        log.warn({ code }, "auth.js warning");
      },
      debug() {},
    },
  };
}

// Lazy config: the adapter (and so the DB connection) is only created on the
// first request, never at import/build time.
export const { handlers, auth, signIn, signOut } = NextAuth(() => buildConfig());
