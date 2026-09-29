/**
 * Server-side handling of an uploaded avatar photo: sniff the real image type
 * with sharp (never trust the client's MIME type or file name), then re-encode
 * to a 512x512 WebP with all metadata (EXIF, GPS, ICC) stripped.
 */

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const AVATAR_PX = 512;

/** Formats we accept as input (SVG and anything exotic is rejected). */
const ACCEPTED_FORMATS = new Set(["jpeg", "png", "webp", "gif", "avif", "heif", "tiff"]);

export type UploadFailure = {
  ok: false;
  status: 400 | 413 | 415 | 422;
  code: "empty" | "too_large" | "not_an_image" | "unsupported" | "unreadable";
  message: string;
};
export type UploadSuccess = { ok: true; webp: Buffer };

const HEIC_HELP = "We couldn't read that photo. HEIC/HEIF isn't supported here, so try a JPG or PNG (or take a new photo).";

export async function processAvatarImage(input: Buffer): Promise<UploadSuccess | UploadFailure> {
  if (input.length === 0) {
    return { ok: false, status: 400, code: "empty", message: "That file is empty." };
  }
  if (input.length > MAX_UPLOAD_BYTES) {
    return { ok: false, status: 413, code: "too_large", message: "That photo is too big. The limit is 5 MB." };
  }

  const sharp = (await import("sharp")).default;
  let format: string | undefined;
  try {
    // limitInputPixels guards against decompression bombs.
    format = (await sharp(input, { limitInputPixels: 80_000_000 }).metadata()).format;
  } catch {
    return { ok: false, status: 415, code: "not_an_image", message: "That doesn't look like an image." };
  }
  if (!format || !ACCEPTED_FORMATS.has(format)) {
    return { ok: false, status: 415, code: "unsupported", message: "Use a JPG, PNG or WebP photo." };
  }

  try {
    const webp = await sharp(input, { limitInputPixels: 80_000_000, failOn: "error" })
      .rotate() // honor EXIF orientation, then the tag is dropped with the rest of the metadata
      .resize(AVATAR_PX, AVATAR_PX, { fit: "cover", position: "centre" })
      .webp({ quality: 86 })
      .toBuffer();
    return { ok: true, webp };
  } catch {
    return {
      ok: false,
      status: 422,
      code: "unreadable",
      message: format === "heif" ? HEIC_HELP : "We couldn't read that photo. Try a JPG or PNG.",
    };
  }
}
