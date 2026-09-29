import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { users } from "@/db/schema";
import { configHash, randomConfig, seededRng } from "@/lib/avatar/config";

// The route's only non-DB dependency is the session; stub it per test.
const session = vi.hoisted(() => ({ user: null as null | { id: string } }));
vi.mock("@/lib/session", () => ({ getCurrentUser: async () => session.user }));

const { GET } = await import("@/app/api/avatar/[userId]/route");
const { resolveUploadPath } = await import("@/lib/avatar/serve");

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "huddle-avatars-"));
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
  const [u] = await db.insert(users).values({ email, onboardedAt: new Date(), ...extra }).returning();
  return u;
}

function get(userId: string, query = "", headers: Record<string, string> = {}) {
  return GET(new Request(`http://localhost/api/avatar/${userId}${query}`, { headers }), {
    params: Promise.resolve({ userId }),
  });
}

describe("GET /api/avatar/[userId]", () => {
  it("401s without a session", async () => {
    const owner = await makeUser("a@example.com");
    const res = await get(owner.id);
    expect(res.status).toBe(401);
  });

  it("404s for unknown, malformed and deactivated users", async () => {
    const viewer = await makeUser("v@example.com");
    session.user = viewer;
    expect((await get("00000000-0000-4000-8000-000000000000")).status).toBe(404);
    expect((await get("../../etc/passwd")).status).toBe(404);
    const gone = await makeUser("gone@example.com", { deactivatedAt: new Date() });
    expect((await get(gone.id)).status).toBe(404);
  });

  it("serves the DiceBear SVG with a strong ETag and honors If-None-Match", async () => {
    const config = randomConfig("micah", seededRng("route"));
    const owner = await makeUser("d@example.com", { avatarKind: "dicebear", avatarConfig: config });
    session.user = await makeUser("viewer@example.com");

    const res = await get(owner.id);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/svg+xml");
    expect(res.headers.get("cache-control")).toMatch(/^private, max-age=\d+/);
    const etag = res.headers.get("etag")!;
    expect(etag).toBe(`"d-${configHash(config)}-svg"`);
    expect((await res.text()).startsWith("<svg")).toBe(true);

    const again = await get(owner.id, "", { "if-none-match": etag });
    expect(again.status).toBe(304);
    expect(await again.text()).toBe("");

    // Versioned URLs are immutable.
    const versioned = await get(owner.id, "?v=abc");
    expect(versioned.headers.get("cache-control")).toContain("immutable");
  });

  it("changes the ETag when the config changes", async () => {
    const a = await makeUser("e1@example.com", { avatarKind: "dicebear", avatarConfig: randomConfig("lorelei", seededRng("1")) });
    const b = await makeUser("e2@example.com", { avatarKind: "dicebear", avatarConfig: randomConfig("lorelei", seededRng("2")) });
    session.user = a;
    expect((await get(a.id)).headers.get("etag")).not.toBe((await get(b.id)).headers.get("etag"));
  });

  it("rasterizes to PNG at the requested size", async () => {
    const owner = await makeUser("p@example.com", { avatarKind: "dicebear", avatarConfig: randomConfig("adventurer", seededRng("p")) });
    session.user = owner;
    const res = await get(owner.id, "?format=png&size=128");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
    expect([meta.width, meta.height]).toEqual([128, 128]);

    expect((await get(owner.id, "?format=gif")).status).toBe(400);
    expect((await get(owner.id, "?format=png&size=99999")).status).toBe(400);
  });

  it("falls back to a seeded default for users without an avatar", async () => {
    const owner = await makeUser("n@example.com");
    session.user = owner;
    const res = await get(owner.id);
    expect(res.status).toBe(200);
    expect((await res.text()).startsWith("<svg")).toBe(true);
  });

  it("streams an uploaded photo from AVATAR_DIR", async () => {
    const png = await sharp({ create: { width: 40, height: 40, channels: 3, background: "#3d9bff" } }).png().toBuffer();
    await writeFile(path.join(dir, "u1.png"), png);
    const owner = await makeUser("u@example.com", { avatarKind: "upload", avatarPath: "u1.png" });
    session.user = owner;

    const res = await get(owner.id);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await res.arrayBuffer()).equals(png)).toBe(true);
    const etag = res.headers.get("etag")!;
    expect((await get(owner.id, "", { "if-none-match": etag })).status).toBe(304);
  });

  it("never reads outside AVATAR_DIR", async () => {
    const owner = await makeUser("t@example.com", { avatarKind: "upload", avatarPath: "../secret.png" });
    session.user = owner;
    const res = await get(owner.id);
    // Falls back to the DiceBear default instead of touching the path.
    expect(res.headers.get("content-type")).toContain("image/svg+xml");
    expect(resolveUploadPath(dir, "../secret.png")).toBeNull();
    expect(resolveUploadPath(dir, "/etc/passwd")).toBeNull();
    expect(resolveUploadPath(dir, "a/b.webp")).toBe(path.join(dir, "a", "b.webp"));
  });
});
