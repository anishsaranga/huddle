import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { users } from "@/db/schema";
import { randomConfig, seededRng } from "@/lib/avatar/config";

const session = vi.hoisted(() => ({ user: null as null | { id: string } }));
vi.mock("@/lib/session", () => ({
  getCurrentUser: async () => session.user,
  requireUser: async () => {
    if (!session.user) throw new Error("not signed in");
    return session.user;
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { checkUsername, saveSection, saveAvatarConfig, finishOnboarding } = await import("@/lib/profile/service");
const { saveSectionAction, saveAvatarConfigAction, finishOnboardingAction } = await import("@/lib/profile/actions");
const { GET: usernameRoute } = await import("@/app/api/me/username/route");

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "huddle-profile-"));
  vi.stubEnv("AVATAR_DIR", dir);
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});
beforeEach(() => {
  session.user = null;
});

async function makeUser(email: string, extra: Partial<typeof users.$inferInsert> = {}) {
  const [u] = await db.insert(users).values({ email, ...extra }).returning();
  return u;
}
const reload = async (id: string) => (await db.select().from(users).where(eq(users.id, id)))[0];

const IDENTITY = { username: "alex_runs", displayName: "Alex" };
const BASICS = { timezone: "Europe/London", units: "metric", dob: "1990-05-05", sex: "female" };
const BODY = { heightCm: 170, weightKg: 62.5, maxHr: null };
const GOALS = { stepGoal: 9000, sleepGoalMin: 465 };

describe("checkUsername", () => {
  it("is available when nobody has it", async () => {
    expect(await checkUsername(db, "fresh_name")).toEqual({ available: true });
  });

  it("is taken case-insensitively (usernames are stored lowercase)", async () => {
    await makeUser("a@example.com", { username: "taken_one" });
    const r = await checkUsername(db, "  Taken_One ");
    expect(r).toMatchObject({ available: false, reason: "taken" });
  });

  it("lets a user keep their own username", async () => {
    const u = await makeUser("b@example.com", { username: "mine" });
    expect(await checkUsername(db, "mine", u.id)).toEqual({ available: true });
    expect(await checkUsername(db, "mine")).toMatchObject({ available: false, reason: "taken" });
  });

  it("flags reserved and invalid names without querying", async () => {
    expect(await checkUsername(db, "admin")).toMatchObject({ available: false, reason: "reserved" });
    expect(await checkUsername(db, "Huddle")).toMatchObject({ available: false, reason: "reserved" });
    expect(await checkUsername(db, "no spaces")).toMatchObject({ available: false, reason: "invalid" });
    expect(await checkUsername(db, "ab")).toMatchObject({ available: false, reason: "invalid" });
    expect(await checkUsername(db, 42)).toMatchObject({ available: false, reason: "invalid" });
  });
});

describe("GET /api/me/username", () => {
  const call = (u: string) => usernameRoute(new Request(`http://localhost/api/me/username?u=${encodeURIComponent(u)}`));

  it("401s without a session", async () => {
    expect((await call("abc")).status).toBe(401);
  });

  it("reports availability for the signed-in user", async () => {
    const me = await makeUser("me@example.com", { username: "myself" });
    await makeUser("other@example.com", { username: "someone" });
    session.user = me;
    expect(await (await call("myself")).json()).toEqual({ available: true });
    expect(await (await call("fresh")).json()).toEqual({ available: true });
    expect(await (await call("someone")).json()).toMatchObject({ available: false, reason: "taken" });
    expect(await (await call("root")).json()).toMatchObject({ available: false, reason: "reserved" });
  });
});

describe("saveSection", () => {
  it("saves each onboarding step to the user row", async () => {
    const u = await makeUser("s@example.com");
    expect(await saveSection(db, u.id, "identity", IDENTITY)).toMatchObject({ ok: true, fields: ["username", "displayName"] });
    expect(await saveSection(db, u.id, "basics", BASICS)).toMatchObject({ ok: true });
    expect(await saveSection(db, u.id, "body", BODY)).toMatchObject({ ok: true });
    expect(await saveSection(db, u.id, "goals", GOALS)).toMatchObject({ ok: true });

    const row = await reload(u.id);
    expect(row).toMatchObject({
      username: "alex_runs",
      displayName: "Alex",
      timezone: "Europe/London",
      units: "metric",
      dob: "1990-05-05",
      sex: "female",
      heightCm: 170,
      weightKg: 62.5,
      maxHr: null,
      stepGoal: 9000,
      sleepGoalMin: 465,
    });
    // Drafts never complete onboarding.
    expect(row.onboardedAt).toBeNull();
  });

  it("normalizes the username and display name", async () => {
    const u = await makeUser("n@example.com");
    await saveSection(db, u.id, "identity", { username: "  Mixed_Case ", displayName: "  Sam  " });
    expect(await reload(u.id)).toMatchObject({ username: "mixed_case", displayName: "Sam" });
  });

  it("rejects invalid input without writing anything", async () => {
    const u = await makeUser("v@example.com", { username: "keepme", displayName: "Keep" });
    const bad = await saveSection(db, u.id, "identity", { username: "admin", displayName: "Nope" });
    expect(bad).toMatchObject({ ok: false, field: "username" });
    expect(await saveSection(db, u.id, "goals", { stepGoal: 5, sleepGoalMin: 480 })).toMatchObject({ ok: false, field: "stepGoal" });
    expect(await saveSection(db, u.id, "basics", { ...BASICS, dob: "2020-01-01" })).toMatchObject({ ok: false, field: "dob" });
    expect(await reload(u.id)).toMatchObject({ username: "keepme", displayName: "Keep", stepGoal: null });
  });

  it("rejects a taken username via the unique index", async () => {
    await makeUser("first@example.com", { username: "dupe" });
    const u = await makeUser("second@example.com");
    const r = await saveSection(db, u.id, "identity", { username: "DUPE", displayName: "Second" });
    expect(r).toMatchObject({ ok: false, field: "username", code: "username_taken" });
    expect((await reload(u.id)).username).toBeNull();
  });

  it("only touches the section's own columns", async () => {
    const u = await makeUser("t@example.com", { stepGoal: 12000, heightCm: 180 });
    await saveSection(db, u.id, "preferences", { timezone: "Asia/Tokyo", units: "imperial" });
    expect(await reload(u.id)).toMatchObject({ timezone: "Asia/Tokyo", units: "imperial", stepGoal: 12000, heightCm: 180 });
    // "personal" covers name, username, dob and sex; not the timezone.
    await saveSection(db, u.id, "personal", { displayName: "T", username: "tee", dob: "1985-02-03", sex: "other" });
    expect(await reload(u.id)).toMatchObject({ username: "tee", dob: "1985-02-03", sex: "other", timezone: "Asia/Tokyo" });
  });

  it("can clear the optional max HR", async () => {
    const u = await makeUser("hr@example.com", { maxHr: 190 });
    await saveSection(db, u.id, "body", { heightCm: 170, weightKg: 60, maxHr: null });
    expect((await reload(u.id)).maxHr).toBeNull();
  });
});

describe("saveAvatarConfig", () => {
  it("stores a valid DiceBear config and rejects garbage", async () => {
    const u = await makeUser("av@example.com");
    const config = randomConfig("micah", seededRng("profile"));
    expect(await saveAvatarConfig(db, u.id, config, dir)).toEqual({ ok: true });
    expect(await reload(u.id)).toMatchObject({ avatarKind: "dicebear", avatarPath: null, avatarConfig: config });
    expect(await saveAvatarConfig(db, u.id, { v: 1, style: "nope", seed: "x", options: {} }, dir)).toMatchObject({ ok: false });
  });
});

describe("finishOnboarding", () => {
  async function completeUser(email: string) {
    const u = await makeUser(email);
    await saveSection(db, u.id, "identity", IDENTITY);
    await saveSection(db, u.id, "basics", BASICS);
    await saveSection(db, u.id, "body", BODY);
    await saveSection(db, u.id, "goals", GOALS);
    return u;
  }

  it("refuses while a step is incomplete and names it", async () => {
    const u = await makeUser("inc@example.com");
    await saveSection(db, u.id, "identity", IDENTITY);
    const r = await finishOnboarding(db, u.id);
    expect(r).toMatchObject({ ok: false, missing: "basics" });
    expect((await reload(u.id)).onboardedAt).toBeNull();
  });

  it("sets onboarded_at once everything is saved, defaulting the avatar", async () => {
    const u = await completeUser("done@example.com");
    expect(await finishOnboarding(db, u.id)).toEqual({ ok: true });
    const row = await reload(u.id);
    expect(row.onboardedAt).toBeInstanceOf(Date);
    expect(row.avatarKind).toBe("dicebear");
    expect(row.avatarConfig).toMatchObject({ v: 1, seed: u.id });
  });

  it("keeps an already-chosen avatar and the original completion time", async () => {
    const u = await completeUser("keep@example.com");
    const config = randomConfig("lorelei", seededRng("keep"));
    await saveAvatarConfig(db, u.id, config, dir);
    await finishOnboarding(db, u.id);
    const first = await reload(u.id);
    expect(first.avatarConfig).toEqual(config);
    await finishOnboarding(db, u.id);
    expect((await reload(u.id)).onboardedAt?.getTime()).toBe(first.onboardedAt?.getTime());
  });

  it("ignores deactivated users", async () => {
    const u = await completeUser("gone@example.com");
    await db.update(users).set({ deactivatedAt: new Date() }).where(eq(users.id, u.id));
    expect(await finishOnboarding(db, u.id)).toMatchObject({ ok: false });
    expect((await reload(u.id)).onboardedAt).toBeNull();
  });
});

describe("server actions", () => {
  it("saveSectionAction requires a session and validates", async () => {
    await expect(saveSectionAction("identity", IDENTITY)).rejects.toThrow("not signed in");

    const u = await makeUser("act@example.com");
    session.user = u;
    expect(await saveSectionAction("identity", IDENTITY)).toEqual({ ok: true });
    expect(await saveSectionAction("goals", { stepGoal: 0, sleepGoalMin: 480 })).toMatchObject({ ok: false, field: "stepGoal" });
    // @ts-expect-error unknown section
    expect(await saveSectionAction("password", {})).toMatchObject({ ok: false });
    expect(await reload(u.id)).toMatchObject({ username: "alex_runs", stepGoal: null });
  });

  it("saveAvatarConfigAction saves the signed-in user's avatar", async () => {
    const u = await makeUser("act2@example.com");
    session.user = u;
    const config = randomConfig("adventurer", seededRng("act"));
    expect(await saveAvatarConfigAction(config)).toEqual({ ok: true });
    expect((await reload(u.id)).avatarConfig).toEqual(config);
    expect(await saveAvatarConfigAction({ nope: true })).toMatchObject({ ok: false });
  });

  it("finishOnboardingAction returns the missing step, or redirects when complete", async () => {
    const u = await makeUser("act3@example.com");
    session.user = u;
    expect(await finishOnboardingAction()).toMatchObject({ ok: false, missing: "identity" });

    await saveSection(db, u.id, "identity", IDENTITY);
    await saveSection(db, u.id, "basics", BASICS);
    await saveSection(db, u.id, "body", BODY);
    await saveSection(db, u.id, "goals", GOALS);
    await expect(finishOnboardingAction("/setup")).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") });
    expect((await reload(u.id)).onboardedAt).toBeInstanceOf(Date);
  });

  it("only redirects to allowed destinations", async () => {
    const u = await makeUser("act4@example.com");
    session.user = u;
    await saveSection(db, u.id, "identity", IDENTITY);
    await saveSection(db, u.id, "basics", BASICS);
    await saveSection(db, u.id, "body", BODY);
    await saveSection(db, u.id, "goals", GOALS);
    // @ts-expect-error not an allowed target
    await expect(finishOnboardingAction("https://evil.example")).rejects.toMatchObject({
      digest: expect.stringMatching(/NEXT_REDIRECT;replace;\/home;/),
    });
  });
});

afterAll(async () => {
  // Nothing should be left in the temp avatar dir by the tests above.
  expect(await readdir(dir)).toEqual([]);
});
