import { describe, expect, it } from "vitest";
import {
  decideSignIn,
  emailDomain,
  isAdminEmail,
  normalizeEmail,
  type SignInFacts,
} from "@/lib/auth-policy";

const ADMIN = "Anish.Admin@Example.com";

const facts = (over: Partial<SignInFacts> = {}): SignInFacts => ({
  email: "friend@example.com",
  emailVerified: true,
  adminEmail: ADMIN,
  isAllowlisted: false,
  deactivated: false,
  ...over,
});

describe("decideSignIn", () => {
  it("always allows the admin and marks them admin, even if not allowlisted", () => {
    expect(decideSignIn(facts({ email: "anish.admin@example.com" }))).toEqual({
      allowed: true,
      isAdmin: true,
      email: "anish.admin@example.com",
    });
  });

  it("allows the admin even when their row is deactivated", () => {
    expect(decideSignIn(facts({ email: ADMIN, deactivated: true }))).toMatchObject({
      allowed: true,
      isAdmin: true,
    });
  });

  it("allows an allowlisted, active user as a non-admin", () => {
    expect(decideSignIn(facts({ isAllowlisted: true }))).toEqual({
      allowed: true,
      isAdmin: false,
      email: "friend@example.com",
    });
  });

  it("denies an email that is not on the allowlist", () => {
    expect(decideSignIn(facts())).toMatchObject({
      allowed: false,
      isAdmin: false,
      reason: "not_allowlisted",
    });
  });

  it("denies an allowlisted but deactivated user", () => {
    expect(decideSignIn(facts({ isAllowlisted: true, deactivated: true }))).toMatchObject({
      allowed: false,
      reason: "deactivated",
    });
  });

  it("denies unverified emails, including the admin's", () => {
    for (const emailVerified of [false, undefined, null]) {
      expect(decideSignIn(facts({ isAllowlisted: true, emailVerified }))).toMatchObject({
        allowed: false,
        reason: "unverified",
      });
      expect(decideSignIn(facts({ email: ADMIN, emailVerified }))).toMatchObject({
        allowed: false,
        isAdmin: false,
        reason: "unverified",
      });
    }
  });

  it("denies a missing email", () => {
    expect(decideSignIn(facts({ email: undefined }))).toMatchObject({
      allowed: false,
      reason: "no_email",
    });
    expect(decideSignIn(facts({ email: "  " }))).toMatchObject({ allowed: false, reason: "no_email" });
  });

  it("matches ADMIN_EMAIL case-insensitively and ignores surrounding whitespace", () => {
    for (const email of [
      "ANISH.ADMIN@EXAMPLE.COM",
      "anish.admin@example.com",
      " Anish.Admin@example.COM ",
    ]) {
      expect(decideSignIn(facts({ email }))).toMatchObject({
        allowed: true,
        isAdmin: true,
        email: "anish.admin@example.com",
      });
    }
  });

  it("matches allowlisted users case-insensitively (email is normalized)", () => {
    expect(decideSignIn(facts({ email: "Friend@Example.COM", isAllowlisted: true }))).toMatchObject({
      allowed: true,
      isAdmin: false,
      email: "friend@example.com",
    });
  });

  it("never makes anyone admin when ADMIN_EMAIL is unset", () => {
    expect(decideSignIn(facts({ adminEmail: undefined, isAllowlisted: true }))).toMatchObject({
      allowed: true,
      isAdmin: false,
    });
    expect(decideSignIn(facts({ adminEmail: "", email: "" }))).toMatchObject({ allowed: false });
  });
});

describe("email helpers", () => {
  it("normalizeEmail lowercases and trims, returning null for empty", () => {
    expect(normalizeEmail(" A@B.Co ")).toBe("a@b.co");
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
  });

  it("isAdminEmail requires both values", () => {
    expect(isAdminEmail("a@b.co", "A@B.CO")).toBe(true);
    expect(isAdminEmail("a@b.co", undefined)).toBe(false);
    expect(isAdminEmail(undefined, "a@b.co")).toBe(false);
  });

  it("emailDomain returns only the domain", () => {
    expect(emailDomain("Someone@Gmail.com")).toBe("gmail.com");
    expect(emailDomain("nope")).toBeUndefined();
  });
});
