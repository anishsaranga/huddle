/**
 * Message body rules (pure; shared by the server action and the composer).
 *
 * - Line endings normalize to "\n"; leading/trailing whitespace is trimmed.
 * - More than 3 blank lines in a row collapse to 3.
 * - 1-1000 characters after that, counted in code points (an emoji is one).
 * - Control characters are rejected (tab and newline are fine), as are the
 *   bidi override/isolate marks that can visually reorder text (spoofing).
 */

export const MAX_MESSAGE_CHARS = 1000;
/** Blank lines allowed in a row. */
export const MAX_BLANK_LINES = 3;

export type BodyError = "empty" | "too_long" | "invalid_chars";
export type BodyResult = { ok: true; body: string } | { ok: false; code: BodyError; message: string };

// C0 controls except \t and \n (\r is normalized away first), DEL, C1 controls.
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/;
// LRE/RLE/PDF/LRO/RLO and LRI/RLI/FSI/PDI.
const BIDI = /[‪-‮⁦-⁩]/;

export function normalizeBody(raw: unknown): BodyResult {
  if (typeof raw !== "string") return { ok: false, code: "empty", message: "Type a message first." };
  let s = raw.replace(/\r\n?/g, "\n");
  if (CONTROL.test(s) || BIDI.test(s)) {
    return { ok: false, code: "invalid_chars", message: "That message contains characters that can't be sent." };
  }
  s = s.trim();
  // A run of N blank lines is N+1 newlines (whitespace-only lines count as blank).
  s = s.replace(/\n(?:[ \t]*\n){4,}/g, "\n".repeat(MAX_BLANK_LINES + 1));
  const length = codePointLength(s);
  if (length === 0) return { ok: false, code: "empty", message: "Type a message first." };
  if (length > MAX_MESSAGE_CHARS) {
    return { ok: false, code: "too_long", message: `Messages can be up to ${MAX_MESSAGE_CHARS} characters.` };
  }
  return { ok: true, body: s };
}

export function codePointLength(s: string): number {
  return Array.from(s).length;
}
