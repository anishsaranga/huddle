/**
 * The "last attempt" line of `GET /api/me/sync-status`: what happened to the
 * most recent ingest request, whatever its status. Pure (no DB), so the Sync
 * page's error copy and the API agree and both are unit-tested.
 *
 * Keep this file free of path aliases and server-only imports: client
 * components import the types and `describeAttemptError`.
 */

import { METRIC_FIELDS } from "../health/fields";
import type { IngestErrors, IngestPayloadShape } from "../ingest/types";

export type LastAttempt = {
  /** When the server received it (ISO 8601, UTC). */
  at: string;
  /** HTTP status it was answered with (401s are never recorded, so never here). */
  status: number;
  /** Payload shape, when the body got far enough to tell. */
  shape: IngestPayloadShape | null;
  /**
   * Non-200 only: the first validation issue (`path: message`, payload
   * strings redacted) or the error code (`invalid_json`, `key_rate_limited`…).
   */
  error?: string;
};

const MAX_ERROR_CHARS = 160;

/**
 * A JSON string literal inside an issue message (those echo payload values).
 * Long ones are cut by the ingest schema and lose their closing quote, so an
 * unterminated literal runs to the end of the message.
 */
const QUOTED_RE = /"(?:[^"\\]|\\.)*(?:"|$)/g;
/** Quoted metric names are ours, not payload text (`series "steps": …`): keep them. */
const KNOWN_QUOTED = new Set<string>(METRIC_FIELDS.map((f) => `"${f.name}"`));

/** `["series", "steps", "values", 3]` → `series.steps.values[3]`. */
export function formatIssuePath(path: readonly (string | number)[]): string {
  let out = "";
  for (const p of path) {
    if (typeof p === "number") out += `[${p}]`;
    else out += out ? `.${p}` : p;
  }
  return out;
}

/**
 * One short line describing an ingest failure, never containing body content:
 * quoted payload strings (e.g. an unparseable timestamp) become `"…"`.
 */
export function summarizeIngestErrors(errors: IngestErrors | null | undefined): string | undefined {
  if (!errors) return undefined;
  const issue = errors.issues?.[0];
  let text: string | undefined;
  if (issue && typeof issue.message === "string") {
    const message = issue.message.replace(QUOTED_RE, (m) => (KNOWN_QUOTED.has(m) ? m : "\"…\""));
    const path = Array.isArray(issue.path) ? formatIssuePath(issue.path) : "";
    text = path ? `${path}: ${message}` : message;
  } else if (typeof errors.reason === "string") {
    text = errors.reason;
  }
  if (!text) return undefined;
  text = text.replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  return text.length > MAX_ERROR_CHARS ? `${text.slice(0, MAX_ERROR_CHARS - 1).trimEnd()}…` : text;
}

/** Friendly sentence for an attempt's status / error code (the raw error is shown next to it). */
export function describeAttemptError(attempt: Pick<LastAttempt, "status" | "error">): string {
  const code = attempt.error ?? "";
  switch (attempt.status) {
    case 400:
      if (code === "invalid_json") return "Huddle couldn’t read the Shortcut’s data as JSON.";
      if (code === "invalid_gzip") return "The Shortcut sent a compressed body Huddle couldn’t unpack.";
      return "Huddle rejected the data your Shortcut sent.";
    case 413:
      return "The Shortcut sent too much data in one go (over 3 MB).";
    case 415:
      return "The Shortcut sent an unsupported encoding.";
    case 429:
      return "Too many syncs in the last hour. Wait a bit and try again.";
    case 500:
      return "Huddle had a problem saving your data. Try again in a minute.";
    default:
      return `The last sync failed (HTTP ${attempt.status}).`;
  }
}
