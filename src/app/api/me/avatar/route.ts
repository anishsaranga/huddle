import { db } from "@/db";
import { childLogger, safePath } from "@/lib/log";
import { MAX_UPLOAD_BYTES, processAvatarImage } from "@/lib/profile/avatar-upload";
import { saveAvatarUpload } from "@/lib/profile/service";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

const log = childLogger("profile");

/** Multipart overhead allowance on top of the file limit when checking Content-Length. */
const BODY_SLACK = 64 * 1024;

const fail = (status: number, error: string, code: string) => Response.json({ error, code }, { status });

/**
 * POST /api/me/avatar (multipart, field `file`): set the signed-in user's
 * avatar to an uploaded photo. The client sends an already cropped square;
 * the server still sniffs the real type with sharp, re-encodes to a 512x512
 * WebP without metadata, stores `${AVATAR_DIR}/${userId}-${hash}.webp`,
 * deletes the previous file and switches avatar_kind to 'upload'.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  // Cheap early rejection before buffering the body.
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES + BODY_SLACK) {
    return fail(413, "That photo is too big. The limit is 5 MB.", "too_large");
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail(400, "Send the photo as multipart form data.", "bad_request");
  }
  const file = form.get("file");
  if (!(file instanceof File)) return fail(400, "No photo was attached.", "bad_request");
  if (file.size > MAX_UPLOAD_BYTES) return fail(413, "That photo is too big. The limit is 5 MB.", "too_large");

  try {
    const processed = await processAvatarImage(Buffer.from(await file.arrayBuffer()));
    if (!processed.ok) {
      log.info({ userId: user.id, code: processed.code }, "avatar upload rejected");
      return fail(processed.status, processed.message, processed.code);
    }
    const saved = await saveAvatarUpload(db, user.id, processed.webp);
    if (!saved.ok) return fail(400, saved.error, "bad_request");
    log.info({ userId: user.id, bytes: processed.webp.length }, "avatar uploaded");
    return Response.json({ ok: true, avatarPath: saved.avatarPath });
  } catch (err) {
    log.error({ userId: user.id, err: err instanceof Error ? err.message : String(err), path: safePath(request.url) }, "avatar upload failed");
    return fail(500, "Couldn't save your photo. Try again.", "server_error");
  }
}
