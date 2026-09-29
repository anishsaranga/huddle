import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { allowedEmails, users } from "@/db/schema";
import { enforceAdminFlags, loadSignInFacts } from "@/lib/auth-db";

const ADMIN = "boss@example.com";

async function isAdmin(email: string) {
  const [row] = await db.select({ isAdmin: users.isAdmin }).from(users).where(eq(users.email, email));
  return row?.isAdmin;
}

describe("enforceAdminFlags", () => {
  it("makes the ADMIN_EMAIL user admin, matching case-insensitively", async () => {
    await db.insert(users).values([{ email: ADMIN }, { email: "friend@example.com" }]);
    await enforceAdminFlags("Boss@Example.COM");
    expect(await isAdmin(ADMIN)).toBe(true);
    expect(await isAdmin("friend@example.com")).toBe(false);
  });

  it("demotes anyone else who has is_admin set", async () => {
    await db.insert(users).values([
      { email: ADMIN },
      { email: "sneaky@example.com", isAdmin: true },
      { email: "old-admin@example.com", isAdmin: true },
    ]);
    expect(await enforceAdminFlags(ADMIN)).toBe(3);
    expect(await isAdmin(ADMIN)).toBe(true);
    expect(await isAdmin("sneaky@example.com")).toBe(false);
    expect(await isAdmin("old-admin@example.com")).toBe(false);
  });

  it("is idempotent", async () => {
    await db.insert(users).values([{ email: ADMIN }, { email: "friend@example.com" }]);
    expect(await enforceAdminFlags(ADMIN)).toBe(1);
    expect(await enforceAdminFlags(ADMIN)).toBe(0);
  });

  it("demotes everyone when ADMIN_EMAIL is unset", async () => {
    await db.insert(users).values({ email: ADMIN, isAdmin: true });
    await enforceAdminFlags(undefined);
    expect(await isAdmin(ADMIN)).toBe(false);
  });
});

describe("loadSignInFacts", () => {
  it("reports allowlist membership and deactivation, case-insensitively", async () => {
    await db
      .insert(allowedEmails)
      .values([{ email: "friend@example.com" }, { email: "gone@example.com" }]);
    await db.insert(users).values({ email: "gone@example.com", deactivatedAt: new Date() });

    expect(await loadSignInFacts("Friend@Example.com")).toEqual({
      isAllowlisted: true,
      deactivated: false,
    });
    expect(await loadSignInFacts("gone@example.com")).toEqual({
      isAllowlisted: true,
      deactivated: true,
    });
    expect(await loadSignInFacts("stranger@example.com")).toEqual({
      isAllowlisted: false,
      deactivated: false,
    });
  });

  it("rejects non-lowercase emails at the database level", async () => {
    await expect(db.insert(allowedEmails).values({ email: "Upper@Example.com" })).rejects.toThrow();
    await expect(db.insert(users).values({ email: "Upper@Example.com" })).rejects.toThrow();
  });
});
