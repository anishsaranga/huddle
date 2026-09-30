/**
 * Minimal Gemini client (REST `generateContent`, no SDK).
 *
 * - The key goes in the `x-goog-api-key` header, never in the URL, and is
 *   never logged. Nor is the prompt: logs carry the model, latency, attempts
 *   and, on failure, a reason code.
 * - Each attempt has a timeout (default 10 s, AbortController). A 429 or 5xx
 *   (or a network error) is retried once after a short backoff; a timeout is
 *   not (the caller falls back instead of waiting another 10 s).
 * - The reply is `candidates[0].content.parts[].text` joined, with markdown
 *   code fences stripped, trimmed and capped (default 600 characters).
 *
 * Never throws: failures come back as `{ ok: false, reason }` so callers can
 * fall back to a template.
 */

import type { Logger } from "pino";
import { childLogger } from "@/lib/log";

export const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
export const GEMINI_TIMEOUT_MS = 10_000;
export const GEMINI_MAX_CHARS = 600;

export type GeminiRequest = {
  /** System instruction. */
  system: string;
  /** The user turn. */
  prompt: string;
  temperature?: number;
  /**
   * Output token budget. Kept small, but not tiny: on "thinking" models the
   * reasoning tokens count against it too, and an exhausted budget returns no text.
   */
  maxOutputTokens?: number;
};

export type GeminiOptions = {
  apiKey?: string;
  model?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** Delay before the retry (ms); a Retry-After of up to 5 s wins. */
  retryDelayMs?: number;
  maxChars?: number;
  log?: Logger;
};

export type GeminiFailure =
  | "not_configured"
  | "invalid_model"
  | "timeout"
  | "network"
  | "rate_limited"
  | "server_error"
  | "http_error"
  | "bad_response"
  | "empty";

export type GeminiResult =
  | { ok: true; text: string; model: string; latencyMs: number; attempts: number }
  | { ok: false; reason: GeminiFailure; status?: number; latencyMs: number; attempts: number };

/** Model ids look like `gemini-2.5-flash` / `gemini-flash-latest`; anything else never reaches the URL. */
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/** `candidates[0].content.parts[].text`, joined; null when there is none. */
export function extractGeminiText(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const candidates = (json as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const parts = (candidates[0] as { content?: { parts?: unknown } } | null)?.content?.parts;
  if (!Array.isArray(parts)) return null;
  const text = parts
    .filter((p) => p && typeof p === "object" && !(p as { thought?: unknown }).thought)
    .map((p) => (p as { text?: unknown }).text)
    .filter((t): t is string => typeof t === "string")
    .join("");
  return text.length > 0 ? text : null;
}

// C0 controls except \t and \n, DEL, C1 controls; bidi overrides/isolates (same rules as chat messages).
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;
const BIDI = /[‪-‮⁦-⁩]/g;

/**
 * Model text → chat-safe text: markdown code fences removed (a fenced reply
 * keeps its inside), control/bidi characters dropped, blank-line runs
 * collapsed, trimmed, and capped at `max` characters (code points), cut at a
 * word boundary with an ellipsis.
 */
export function cleanModelText(raw: string, max = GEMINI_MAX_CHARS): string {
  let s = raw.replace(/\r\n?/g, "\n");
  const fenced = /^\s*```[\w-]*[ \t]*\n([\s\S]*?)\n?```\s*$/.exec(s);
  if (fenced) s = fenced[1];
  s = s.replace(/^[ \t]*```[\w-]*[ \t]*$/gm, "");
  s = s.replace(CONTROL, "").replace(BIDI, "");
  s = s.replace(/\n[ \t]*(?:\n[ \t]*){2,}/g, "\n\n").trim();
  const chars = Array.from(s);
  if (chars.length <= max) return s;
  const cut = chars.slice(0, max - 1).join("");
  const at = Math.max(cut.lastIndexOf(" "), cut.lastIndexOf("\n"));
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).trimEnd()}…`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function retryAfterMs(res: Response, fallback: number): number {
  const v = Number(res.headers.get("retry-after"));
  return Number.isFinite(v) && v > 0 && v <= 5 ? v * 1000 : fallback;
}

type Attempt =
  | { kind: "ok"; json: unknown }
  | { kind: "retryable"; reason: GeminiFailure; status?: number; waitMs: number }
  | { kind: "fatal"; reason: GeminiFailure; status?: number };

/** One text generation. See the file header. */
export async function geminiGenerate(req: GeminiRequest, opts: GeminiOptions = {}): Promise<GeminiResult> {
  const log = opts.log ?? childLogger("ai");
  const started = Date.now();
  const model = opts.model?.trim();
  const apiKey = opts.apiKey?.trim();
  const done = (r: GeminiResult): GeminiResult => {
    const base = { provider: "gemini", model: model ?? null, latencyMs: r.latencyMs, attempts: r.attempts };
    if (r.ok) log.info({ ...base, chars: r.text.length }, "ai generation ok");
    else log.warn({ ...base, reason: r.reason, status: r.status }, "ai generation failed");
    return r;
  };
  if (!apiKey || !model) return done({ ok: false, reason: "not_configured", latencyMs: 0, attempts: 0 });
  if (!MODEL_RE.test(model)) return done({ ok: false, reason: "invalid_model", latencyMs: 0, attempts: 0 });

  const doFetch = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? GEMINI_TIMEOUT_MS;
  const url = `${GEMINI_ENDPOINT}/${encodeURIComponent(model)}:generateContent`;
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: req.system }] },
    contents: [{ role: "user", parts: [{ text: req.prompt }] }],
    generationConfig: {
      temperature: req.temperature ?? 0.9,
      maxOutputTokens: req.maxOutputTokens ?? 1024,
      candidateCount: 1,
    },
  });

  const attempt = async (): Promise<Attempt> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await doFetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        body,
        signal: ctrl.signal,
      });
      if (res.status === 429) return { kind: "retryable", reason: "rate_limited", status: 429, waitMs: retryAfterMs(res, opts.retryDelayMs ?? 1500) };
      if (res.status >= 500) return { kind: "retryable", reason: "server_error", status: res.status, waitMs: opts.retryDelayMs ?? 1500 };
      if (!res.ok) return { kind: "fatal", reason: "http_error", status: res.status };
      try {
        return { kind: "ok", json: await res.json() };
      } catch {
        return ctrl.signal.aborted ? { kind: "fatal", reason: "timeout" } : { kind: "fatal", reason: "bad_response", status: res.status };
      }
    } catch {
      if (ctrl.signal.aborted) return { kind: "fatal", reason: "timeout" };
      return { kind: "retryable", reason: "network", waitMs: opts.retryDelayMs ?? 1500 };
    } finally {
      clearTimeout(timer);
    }
  };

  let attempts = 1;
  let r = await attempt();
  if (r.kind === "retryable") {
    await sleep(r.waitMs);
    attempts = 2;
    r = await attempt();
  }
  const latencyMs = Date.now() - started;
  if (r.kind !== "ok") return done({ ok: false, reason: r.reason, status: r.status, latencyMs, attempts });

  const raw = extractGeminiText(r.json);
  const text = raw === null ? "" : cleanModelText(raw, opts.maxChars ?? GEMINI_MAX_CHARS);
  if (!text) {
    // A well-formed reply without text (blocked, or the token budget ran out) is "empty".
    const shaped = !!r.json && typeof r.json === "object" && ("candidates" in r.json || "promptFeedback" in r.json);
    return done({ ok: false, reason: shaped ? "empty" : "bad_response", latencyMs, attempts });
  }
  return done({ ok: true, text, model, latencyMs, attempts });
}
