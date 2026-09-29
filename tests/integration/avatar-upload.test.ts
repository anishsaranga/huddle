import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { users } from "@/db/schema";
import { randomConfig, seededRng } from "@/lib/avatar/config";
import { saveAvatarConfig } from "@/lib/profile/service";

const session = vi.hoisted(() => ({ user: null as null | { id: string } }));
vi.mock("@/lib/session", () => ({ getCurrentUser: async () => session.user }));

const { POST } = await import("@/app/api/me/avatar/route");
const { GET: getAvatar } = await import("@/app/api/avatar/[userId]/route");

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "huddle-upload-"));
  vi.stubEnv("AVATAR_DIR", dir);
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});
beforeEach(async () => {
  session.user = null;
  for (const f of await readdir(dir)) await rm(path.join(dir, f), { force: true });
});

async function makeUser(email: string) {
  const [u] = await db.insert(users).values({ email, onboardedAt: new Date() }).returning();
  return u;
}
const reload = async (id: string) => (await db.select().from(users).where(eq(users.id, id)))[0];

function upload(body: Buffer | string, opts: { type?: string; name?: string; field?: string } = {}) {
  const form = new FormData();
  form.append(opts.field ?? "file", new File([new Uint8Array(Buffer.from(body))], opts.name ?? "avatar.jpg", { type: opts.type ?? "image/jpeg" }));
  return POST(new Request("http://localhost/api/me/avatar", { method: "POST", body: form }));
}

const png = (w = 300, h = 200, background = "#3d9bff") =>
  sharp({ create: { width: w, height: h, channels: 3, background } }).png().toBuffer();

describe("POST /api/me/avatar", () => {
  it("401s without a session", async () => {
    expect((await upload(await png())).status).toBe(401);
  });

  it("re-encodes a valid image to a 512x512 WebP and stores it", async () => {
    const me = await makeUser("up@example.com");
    session.user = me;
    const res = await upload(await png(800, 400));
    expect(res.status).toBe(200);
    const { avatarPath } = (await res.json()) as { avatarPath: string };
    expect(avatarPath).toMatch(new RegExp(`^${me.id}-[0-9a-f]{12}\\.webp$`));

    const files = await readdir(dir);
    expect(files).toEqual([avatarPath]);
    const meta = await sharp(await readFile(path.join(dir, avatarPath))).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["webp", 512, 512]);

    expect(await reload(me.id)).toMatchObject({ avatarKind: "upload", avatarPath });
  });

  it("serves the stored photo through /api/avatar/[userId]", async () => {
    const me = await makeUser("serve@example.com");
    session.user = me;
    await upload(await png());
    const res = await getAvatar(new Request(`http://localhost/api/avatar/${me.id}`), { params: Promise.resolve({ userId: me.id }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
  });

  it("strips EXIF metadata and honors orientation", async () => {
    const me = await makeUser("exif@example.com");
    session.user = me;
    // 200 wide x 100 tall JPEG tagged "rotate 90 CW" and carrying a copyright string.
    const tagged = await sharp({ create: { width: 200, height: 100, channels: 3, background: "#ff0000" } })
      .jpeg()
      .withMetadata({ orientation: 6, exif: { IFD0: { Copyright: "secret-owner" } } })
      .toBuffer();
    expect((await sharp(tagged).metadata()).exif).toBeDefined();

    const res = await upload(tagged);
    expect(res.status).toBe(200);
    const { avatarPath } = (await res.json()) as { avatarPath: string };
    const stored = await readFile(path.join(dir, avatarPath));
    const meta = await sharp(stored).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.icc).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
    expect(stored.includes(Buffer.from("secret-owner"))).toBe(false);
  });

  it("deletes the previous upload when a new one replaces it", async () => {
    const me = await makeUser("swap@example.com");
    session.user = me;
    const first = (await (await upload(await png(300, 300, "#ff0000"))).json()) as { avatarPath: string };
    const second = (await (await upload(await png(300, 300, "#00ff00"))).json()) as { avatarPath: string };
    expect(second.avatarPath).not.toBe(first.avatarPath);
    expect(await readdir(dir)).toEqual([second.avatarPath]);
    expect((await reload(me.id)).avatarPath).toBe(second.avatarPath);
  });

  it("uploading the same photo twice keeps the file", async () => {
    const me = await makeUser("same@example.com");
    session.user = me;
    const img = await png(300, 300, "#123456");
    const a = (await (await upload(img)).json()) as { avatarPath: string };
    const b = (await (await upload(img)).json()) as { avatarPath: string };
    expect(b.avatarPath).toBe(a.avatarPath);
    expect(await readdir(dir)).toEqual([a.avatarPath]);
  });

  it("switching back to a character deletes the uploaded file", async () => {
    const me = await makeUser("back@example.com");
    session.user = me;
    await upload(await png());
    expect(await readdir(dir)).toHaveLength(1);
    await saveAvatarConfig(db, me.id, randomConfig("micah", seededRng("back")), dir);
    expect(await readdir(dir)).toEqual([]);
    expect(await reload(me.id)).toMatchObject({ avatarKind: "dicebear", avatarPath: null });
  });

  it("rejects non-images even with an image MIME type and extension", async () => {
    const me = await makeUser("bad@example.com");
    session.user = me;
    const res = await upload("this is definitely not a picture", { type: "image/png", name: "evil.png" });
    expect(res.status).toBe(415);
    expect((await res.json()).code).toBe("not_an_image");
    expect(await readdir(dir)).toEqual([]);
    expect((await reload(me.id)).avatarKind).toBeNull();
  });

  it("rejects SVG (scriptable) uploads", async () => {
    const me = await makeUser("svg@example.com");
    session.user = me;
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>';
    const res = await upload(svg, { type: "image/svg+xml", name: "a.svg" });
    expect(res.status).toBe(415);
    expect(await readdir(dir)).toEqual([]);
  });

  it("rejects files over 5 MB", async () => {
    const me = await makeUser("big@example.com");
    session.user = me;
    // A valid PNG header followed by padding: the size check runs before decoding.
    const big = Buffer.concat([await png(), Buffer.alloc(5 * 1024 * 1024 + 1)]);
    const res = await upload(big, { type: "image/png" });
    expect(res.status).toBe(413);
    expect(await readdir(dir)).toEqual([]);
  });

  it("rejects an empty file and a missing file field", async () => {
    const me = await makeUser("empty@example.com");
    session.user = me;
    expect((await upload(Buffer.alloc(0))).status).toBe(400);
    expect((await upload(await png(), { field: "photo" })).status).toBe(400);
    const notForm = await POST(new Request("http://localhost/api/me/avatar", { method: "POST", body: "hi" }));
    expect(notForm.status).toBe(400);
  });

  it("gives a friendly error for images sharp can't decode (e.g. HEIC)", async () => {
    const me = await makeUser("heic@example.com");
    session.user = me;
    // A minimal HEIF container header (ftyp heic): sharp identifies the format but can't decode without a codec.
    const heic = Buffer.concat([
      Buffer.from([0, 0, 0, 24]),
      Buffer.from("ftypheic", "ascii"),
      Buffer.from([0, 0, 0, 0]),
      Buffer.from("mif1heic", "ascii"),
      Buffer.alloc(64),
    ]);
    const res = await upload(heic, { type: "image/heic", name: "IMG_0001.HEIC" });
    expect([415, 422]).toContain(res.status);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/JPG|PNG|image/i);
    expect(await readdir(dir)).toEqual([]);
  });
});
