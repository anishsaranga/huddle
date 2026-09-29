import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { users, type User } from "@/db/schema";
import { configHash, defaultConfigForSeed, parseAvatarConfig } from "./config";
import { renderAvatarSvg } from "./render";

/**
 * Server-side avatar serving for GET /api/avatar/[userId].
 * Upload paths are runtime data (AVATAR_DIR), so fs calls carry
 * `turbopackIgnore` to keep the build from tracing the whole project.
 */

export type AvatarOwner = Pick<User, "id" | "avatarKind" | "avatarConfig" | "avatarPath">;

/** An active (not deactivated) user's avatar fields, or null. */
export async function getAvatarOwner(userId: string): Promise<AvatarOwner | null> {
  const [row] = await db
    .select({ id: users.id, avatarKind: users.avatarKind, avatarConfig: users.avatarConfig, avatarPath: users.avatarPath })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deactivatedAt)))
    .limit(1);
  return row ?? null;
}

/** Upload directory: AVATAR_DIR, else ./data/avatars (dev) or /data/avatars (production). */
export function avatarDir(env: Record<string, string | undefined> = process.env): string {
  if (env.AVATAR_DIR) return path.resolve(env.AVATAR_DIR);
  return env.NODE_ENV === "production" ? "/data/avatars" : path.resolve("data", "avatars");
}

/** Resolve a stored avatar_path inside the avatar dir; null if it tries to escape. */
export function resolveUploadPath(dir: string, stored: string): string | null {
  if (!stored || stored.includes("\0") || path.isAbsolute(stored)) return null;
  const root = path.resolve(dir);
  const full = path.resolve(root, stored);
  const rel = path.relative(root, full);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return full;
}

const UPLOAD_TYPES: Record<string, string> = {
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".avif": "image/avif",
};

export const PNG_DEFAULT_SIZE = 256;
const PNG_MIN = 16;
const PNG_MAX = 1024;

type Query = { format: "svg" | "png"; size?: number; versioned: boolean };

export function parseAvatarQuery(url: URL): Query | { error: string } {
  const format = url.searchParams.get("format") ?? "svg";
  if (format !== "svg" && format !== "png") return { error: "format must be svg or png" };
  const rawSize = url.searchParams.get("size");
  let size: number | undefined;
  if (rawSize !== null) {
    size = Number(rawSize);
    if (!Number.isInteger(size) || size < PNG_MIN || size > PNG_MAX) {
      return { error: `size must be an integer from ${PNG_MIN} to ${PNG_MAX}` };
    }
  }
  if (format === "png" && size === undefined) size = PNG_DEFAULT_SIZE;
  return { format, size, versioned: url.searchParams.has("v") };
}

function cacheControl(versioned: boolean): string {
  // A `?v=` URL changes whenever the avatar does, so it can be cached for good.
  return versioned ? "private, max-age=31536000, immutable" : "private, max-age=300, stale-while-revalidate=86400";
}

function etagMatches(request: Request, etag: string): boolean {
  const header = request.headers.get("if-none-match");
  if (!header) return false;
  return header.split(",").some((t) => t.trim() === etag || t.trim() === "*");
}

function notModified(etag: string, cc: string): Response {
  return new Response(null, { status: 304, headers: { ETag: etag, "Cache-Control": cc } });
}

async function rasterize(input: Buffer | string, size: number): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return sharp(buf).resize(size, size, { fit: "cover" }).png({ compressionLevel: 9 }).toBuffer();
}

/** Build the avatar response for an owner (already authorized). */
export async function avatarResponse(
  owner: AvatarOwner,
  request: Request,
  opts: { dir?: string } = {},
): Promise<Response> {
  const url = new URL(request.url);
  const q = parseAvatarQuery(url);
  if ("error" in q) return Response.json({ error: q.error }, { status: 400 });
  const cc = cacheControl(q.versioned);

  if (owner.avatarKind === "upload" && owner.avatarPath) {
    const file = resolveUploadPath(opts.dir ?? avatarDir(), owner.avatarPath);
    const type = UPLOAD_TYPES[path.extname(owner.avatarPath).toLowerCase()];
    const info = file && type ? await stat(/*turbopackIgnore: true*/ file).catch(() => null) : null;
    if (file && type && info?.isFile()) {
      const etag = `"u-${Math.floor(info.mtimeMs).toString(36)}-${info.size.toString(36)}-${q.format}${q.size ?? ""}"`;
      if (etagMatches(request, etag)) return notModified(etag, cc);
      const headers = { ETag: etag, "Cache-Control": cc, "X-Content-Type-Options": "nosniff" };
      if (q.format === "png") {
        const { readFile } = await import("node:fs/promises");
        const png = await rasterize(await readFile(/*turbopackIgnore: true*/ file), q.size ?? PNG_DEFAULT_SIZE);
        return new Response(new Uint8Array(png), { headers: { ...headers, "Content-Type": "image/png" } });
      }
      const body = Readable.toWeb(createReadStream(/*turbopackIgnore: true*/ file)) as ReadableStream<Uint8Array>;
      return new Response(body, {
        headers: { ...headers, "Content-Type": type, "Content-Length": String(info.size) },
      });
    }
    // Missing file: fall through to the DiceBear avatar (or the seeded default).
  }

  const config = parseAvatarConfig(owner.avatarConfig) ?? defaultConfigForSeed(owner.id);
  const etag = `"d-${configHash(config)}-${q.format}${q.size ?? ""}"`;
  if (etagMatches(request, etag)) return notModified(etag, cc);
  const headers = { ETag: etag, "Cache-Control": cc, "X-Content-Type-Options": "nosniff" };

  const svg = renderAvatarSvg(config, { size: q.size });
  if (q.format === "png") {
    const png = await rasterize(svg, q.size ?? PNG_DEFAULT_SIZE);
    return new Response(new Uint8Array(png), { headers: { ...headers, "Content-Type": "image/png" } });
  }
  return new Response(svg, {
    headers: {
      ...headers,
      "Content-Type": "image/svg+xml; charset=utf-8",
      // Opened directly, the SVG can't run script or load anything.
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
