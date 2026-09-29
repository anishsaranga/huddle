/**
 * Reading an ingest request body safely: a byte cap enforced from
 * Content-Length, while streaming, and after gzip decompression (so a small
 * compressed "zip bomb" can't expand past it). Then strict UTF-8 JSON.
 */

import { gunzip } from "node:zlib";
import { promisify } from "node:util";

const gunzipAsync = promisify(gunzip);

/** 3 MB: the cap on the wire and after decompression. */
export const MAX_BODY_BYTES = 3 * 1024 * 1024;

export type BodyFailure = {
  ok: false;
  status: 400 | 413 | 415;
  reason: "too_large" | "decompressed_too_large" | "invalid_gzip" | "unsupported_encoding";
  /** Bytes received (or declared, for a Content-Length rejection). */
  bytes: number;
  gzip: boolean;
};

export type BodyResult = { ok: true; data: Uint8Array; bytes: number; gzip: boolean } | BodyFailure;

function contentEncoding(headers: Headers): "identity" | "gzip" | null {
  const raw = (headers.get("content-encoding") ?? "").trim().toLowerCase();
  if (raw === "" || raw === "identity") return "identity";
  if (raw === "gzip" || raw === "x-gzip") return "gzip";
  return null;
}

/** Read the whole body, never holding more than `max` bytes of it. */
export async function readBody(request: Request, max: number = MAX_BODY_BYTES): Promise<BodyResult> {
  const encoding = contentEncoding(request.headers);
  const gzip = encoding === "gzip";
  if (!encoding) {
    await request.body?.cancel().catch(() => {});
    return { ok: false, status: 415, reason: "unsupported_encoding", bytes: 0, gzip };
  }

  const declared = request.headers.get("content-length");
  if (declared !== null && /^\d+$/.test(declared.trim())) {
    const n = Number(declared.trim());
    if (n > max) {
      await request.body?.cancel().catch(() => {});
      return { ok: false, status: 413, reason: "too_large", bytes: Math.min(n, 2 ** 31 - 1), gzip };
    }
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  if (request.body) {
    const reader = request.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        await reader.cancel().catch(() => {});
        return { ok: false, status: 413, reason: "too_large", bytes: total, gzip };
      }
      chunks.push(value);
    }
  }
  const raw = Buffer.concat(chunks, total);

  if (!gzip) return { ok: true, data: raw, bytes: total, gzip };
  try {
    const data = await gunzipAsync(raw, { maxOutputLength: max });
    return { ok: true, data, bytes: total, gzip };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ERR_BUFFER_TOO_LARGE") {
      return { ok: false, status: 413, reason: "decompressed_too_large", bytes: total, gzip };
    }
    return { ok: false, status: 400, reason: "invalid_gzip", bytes: total, gzip };
  }
}

export type JsonResult = { ok: true; value: unknown; text: string } | { ok: false; detail: string; text: string };

/** Strict UTF-8 (a BOM is fine) then JSON.parse. */
export function decodeJson(data: Uint8Array): JsonResult {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    return { ok: false, detail: "body is not valid UTF-8", text: "" };
  }
  if (text.trim() === "") return { ok: false, detail: "empty body", text };
  try {
    return { ok: true, value: JSON.parse(text), text };
  } catch (err) {
    return { ok: false, detail: (err as Error).message.slice(0, 200), text };
  }
}
