import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { sessions, users } from "@/db/schema";
import { enforceAdminFlags } from "@/lib/auth-db";
import { emailDomain, normalizeEmail } from "@/lib/auth-policy";
import { childLogger } from "@/lib/log";
import { isLoopbackHost, isTestAuthEnabled } from "@/lib/test-auth";

/*
 * E2E-ONLY login bypass. Creates (or reuses) a user and a database session,
 * then sets the Auth.js session cookie. See docs/dev.md.
 *
 * Evaluated once at module load: false in every production build (NODE_ENV is
 * inlined) and false in dev unless the server was started with E2E_AUTH=1.
 */
const ENABLED = isTestAuthEnabled();

export const dynamic = "force-dynamic";

const log = childLogger("auth");

const Body = z.object({
  email: z.email(),
  name: z.string().min(1).max(80).optional(),
  /** Default true, so app pages render; pass false to exercise /onboarding. */
  onboarded: z.boolean().default(true),
});

const SESSION_DAYS = 30;
/** Non-secure name: this route never runs in production (useSecureCookies is off in dev). */
const COOKIE_NAME = "authjs.session-token";

const notFound = () => new Response("Not Found", { status: 404 });

export async function POST(request: Request) {
  if (!ENABLED) return notFound();
  if (!isLoopbackHost(new URL(request.url).hostname)) return notFound();

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid body" }, { status: 400 });
  const email = normalizeEmail(parsed.data.email)!;
  const { name, onboarded } = parsed.data;

  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const onboardedAt = onboarded ? (existing?.onboardedAt ?? new Date()) : null;
  const [user] = existing
    ? await db
        .update(users)
        .set({ onboardedAt, ...(name ? { name, displayName: name } : {}) })
        .where(eq(users.id, existing.id))
        .returning()
    : await db
        .insert(users)
        .values({
          email,
          name: name ?? null,
          displayName: name ?? null,
          username: onboarded ? email.split("@")[0].replace(/[^a-z0-9_]/g, "_").slice(0, 24) : null,
          emailVerified: new Date(),
          onboardedAt,
        })
        .returning();

  // Same admin rule as a real sign-in.
  await enforceAdminFlags(process.env.ADMIN_EMAIL);

  const sessionToken = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.insert(sessions).values({ sessionToken, userId: user.id, expires });

  log.warn({ userId: user.id, domain: emailDomain(email) }, "e2e test login (bypass)");

  const res = Response.json({ userId: user.id });
  res.headers.append(
    "Set-Cookie",
    `${COOKIE_NAME}=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Expires=${expires.toUTCString()}`,
  );
  return res;
}

/** Never reveal the route via 405s. */
export function GET() {
  return notFound();
}
