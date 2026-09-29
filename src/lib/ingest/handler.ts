/**
 * POST /api/ingest: the whole request pipeline (the route file is a thin
 * wrapper). Order:
 *
 * 1. Per-IP rate limit (before auth, so floods of bad keys get 429 too).
 * 2. API key (Bearer or ?key=). Missing / malformed / unknown / revoked /
 *    deactivated -> bare 401; logged with ip + reason only, never stored.
 * 3. Per-key rate limit -> 429 + Retry-After.
 * 4. Body: 3 MB cap (Content-Length, streaming, and after gzip) -> 413.
 * 5. JSON -> 400; structure (zod) and timezone checks -> 400 with issues.
 * 6. One transaction upserts everything; then the scores hook.
 *
 * Every authenticated request (any status) gets an `ingest_events` row and
 * one info log line. The key never reaches a log line or the stored body.
 */

import type { Logger } from "pino";
import { db as appDb } from "@/db";
import { ingestEvents } from "@/db/schema";
import type { Db } from "@/lib/admin/db";
import { authenticateApiKey, extractApiKey, isWellFormedApiKey, type ApiKeyPrincipal } from "@/lib/apikey";
import { MAX_BODY_BYTES, decodeJson, readBody } from "@/lib/ingest/body";
import { normalizeIngest } from "@/lib/ingest/normalize";
import { MAX_ISSUES, parsePayload, type Issue } from "@/lib/ingest/schema";
import { scrubSecrets } from "@/lib/ingest/scrub";
import { buildSummary, collectUnknownFields, compactFieldTotals, partialSummary } from "@/lib/ingest/summary";
import type { IngestAuthMethod, IngestErrors, IngestSummary } from "@/lib/ingest/types";
import { upsertIngest } from "@/lib/ingest/upsert";
import { childLogger, safePath } from "@/lib/log";
import { clientIp, getIngestLimiters, type IngestLimiters } from "@/lib/ratelimit";
import { onDataIngested } from "@/lib/scores/hooks";

export type IngestDeps = {
  db: Db;
  log: Logger;
  limiters: IngestLimiters;
  now: () => Date;
  onDataIngested: (userId: string, affectedDates: readonly string[]) => Promise<void> | void;
};

/** Collaborators, swappable in tests (logger capture, limiter reset, failing hook). */
export const ingestDeps: IngestDeps = {
  db: appDb,
  log: childLogger("ingest"),
  limiters: getIngestLimiters(),
  now: () => new Date(),
  onDataIngested,
};

const NO_STORE = { "Cache-Control": "no-store" } as const;
/** Invalid-JSON bodies are stored as a text prefix this long (for debugging a Shortcut). */
const RAW_TEXT_PREFIX = 64 * 1024;

const json = (body: unknown, status: number, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { ...NO_STORE, ...headers } });

const rateLimited = (retryAfterSec: number) =>
  json({ error: "rate_limited", retry_after: retryAfterSec }, 429, { "Retry-After": String(retryAfterSec) });

type Ctx = {
  principal: ApiKeyPrincipal;
  key: string;
  auth: IngestAuthMethod;
  ip: string;
  path: string;
  receivedAt: Date;
  t0: number;
  bytes: number;
};

type Outcome = {
  summary?: IngestSummary;
  body?: unknown;
  errors?: IngestErrors;
};

function trimIssues(issues: Issue[]): Issue[] {
  return issues.slice(0, MAX_ISSUES).map((i) => ({ path: i.path, message: i.message.slice(0, 300) }));
}

/** Record the event, write the log line, return the response. Never throws. */
async function finish(ctx: Ctx, status: number, raw: Outcome, response: Response): Promise<Response> {
  const { log, db } = ingestDeps;
  // Issue messages / unknown names echo payload values: keep anything key-shaped out of them.
  const outcome: Outcome = {
    summary: raw.summary && (scrubSecrets(raw.summary, ctx.key, false) as IngestSummary),
    errors: raw.errors && (scrubSecrets(raw.errors, ctx.key, false) as IngestErrors),
    body: raw.body, // already scrubbed
  };
  const durationMs = Math.round(performance.now() - ctx.t0);
  try {
    await db.insert(ingestEvents).values({
      userId: ctx.principal.userId,
      receivedAt: ctx.receivedAt,
      status,
      authMethod: ctx.auth,
      bytes: ctx.bytes,
      durationMs,
      summary: outcome.summary ?? null,
      body: outcome.body ?? null,
      errors: outcome.errors ?? null,
    });
  } catch (err) {
    log.error({ err, userId: ctx.principal.userId, status }, "ingest: failed to record ingest event");
  }

  const s = outcome.summary;
  log.info(
    {
      userId: ctx.principal.userId,
      username: ctx.principal.username,
      auth: ctx.auth,
      ip: ctx.ip,
      path: ctx.path,
      bytes: ctx.bytes,
      durationMs,
      status,
      days: s?.days,
      dateRange: s?.dateRange,
      fieldTotals: s ? compactFieldTotals(s) : undefined,
      unknownFields: s?.unknownFields,
      hrHourlyCount: s?.hrHourlyCount,
      sleepSegmentCount: s?.sleepSegmentCount,
      sleepSources: s?.sleepSources,
      nights: s?.nights,
      rowsInserted: s?.rowsInserted,
      rowsUpdated: s?.rowsUpdated,
      reason: outcome.errors?.reason,
      issues: outcome.errors?.issues,
    },
    status === 200 ? "ingest ok" : "ingest rejected",
  );
  return response;
}

/** Bare 401: nothing in the body, and only ip/reason/method in the log. */
function unauthorized(ip: string, path: string, reason: string, auth: IngestAuthMethod | "none"): Response {
  ingestDeps.log.info({ ip, path, reason, auth_method: auth, status: 401 }, "ingest unauthorized");
  return new Response(null, { status: 401, headers: NO_STORE });
}

export async function handleIngest(request: Request): Promise<Response> {
  const t0 = performance.now();
  const { log, db, limiters } = ingestDeps;
  const receivedAt = ingestDeps.now();
  const nowMs = receivedAt.getTime();
  const ip = clientIp(request.headers);
  const path = safePath(request.url);
  const creds = extractApiKey(request);
  let ctx: Ctx | null = null;

  try {
    // 1. Per-IP limit, counted before auth.
    const ipGate = limiters.ip.hit(ip, nowMs);
    if (!ipGate.ok) {
      // Attribute the 429 to a user only when the key is valid (well-formed keys cost one indexed lookup).
      const principal = creds && isWellFormedApiKey(creds.key) ? await authenticateApiKey(db, creds.key, receivedAt) : null;
      if (!principal) {
        log.info({ ip, path, reason: "ip_rate_limited", auth_method: creds?.method ?? "none", status: 429 }, "ingest rejected");
        return rateLimited(ipGate.retryAfterSec);
      }
      ctx = { principal, key: creds!.key, auth: creds!.method, ip, path, receivedAt, t0, bytes: 0 };
      return finish(ctx, 429, { errors: { reason: "ip_rate_limited" } }, rateLimited(ipGate.retryAfterSec));
    }

    // 2. Authenticate.
    if (!creds) return unauthorized(ip, path, "missing_key", "none");
    if (!isWellFormedApiKey(creds.key)) return unauthorized(ip, path, "malformed_key", creds.method);
    const principal = await authenticateApiKey(db, creds.key, receivedAt);
    // Unknown, revoked, or the user is deactivated (indistinguishable on purpose).
    if (!principal) return unauthorized(ip, path, "invalid_key", creds.method);
    ctx = { principal, key: creds.key, auth: creds.method, ip, path, receivedAt, t0, bytes: 0 };

    // 3. Per-key limit.
    const keyGate = limiters.key.hit(principal.keyId, nowMs);
    if (!keyGate.ok) {
      return finish(ctx, 429, { errors: { reason: "key_rate_limited" } }, rateLimited(keyGate.retryAfterSec));
    }

    // 4. Body.
    const body = await readBody(request);
    ctx.bytes = body.bytes;
    if (!body.ok) {
      const errors: IngestErrors = { reason: body.reason };
      const res =
        body.status === 413
          ? json({ error: "too_large", max_bytes: MAX_BODY_BYTES }, 413)
          : body.status === 415
            ? json({ error: "unsupported_encoding", supported: ["gzip", "identity"] }, 415)
            : json({ error: body.reason }, 400);
      return finish(ctx, body.status, { errors, summary: { days: 0, dateRange: null, gzip: body.gzip } }, res);
    }
    const gzipInfo = body.gzip ? { gzip: true, decodedBytes: body.data.byteLength } : { gzip: false };

    // 5. JSON and validation.
    const decoded = decodeJson(body.data);
    if (!decoded.ok) {
      const rawPrefix = scrubSecrets(decoded.text.slice(0, RAW_TEXT_PREFIX), creds.key);
      return finish(
        ctx,
        400,
        { errors: { reason: "invalid_json", detail: decoded.detail }, body: rawPrefix, summary: { days: 0, dateRange: null, ...gzipInfo } },
        json({ error: "invalid_json", detail: decoded.detail }, 400),
      );
    }
    const stored = scrubSecrets(decoded.value, creds.key);
    log.debug({ userId: principal.userId, body: stored }, "ingest body");
    const unknownFields = collectUnknownFields(decoded.value);

    const parsed = parsePayload(decoded.value);
    const normalized = parsed.ok ? normalizeIngest(parsed.payload, { profileTz: principal.timezone, now: receivedAt }) : null;
    if (!parsed.ok || !normalized!.ok) {
      const issues = trimIssues(!parsed.ok ? parsed.issues : (normalized as { ok: false; issues: Issue[] }).issues);
      const summary = { ...partialSummary(decoded.value, unknownFields), ...gzipInfo };
      return finish(
        ctx,
        400,
        { summary, body: stored, errors: { reason: "validation", issues } },
        json({ error: "validation", issues }, 400),
      );
    }
    const n = normalized!.value;

    // 6. Store.
    let result;
    try {
      result = await upsertIngest(db, principal.userId, n);
    } catch (err) {
      log.error({ err, userId: principal.userId }, "ingest: upsert failed");
      const summary = buildSummary(n, { unknownFields, ...gzipInfo });
      return finish(
        ctx,
        500,
        { summary, body: stored, errors: { reason: "upsert_failed", detail: String((err as Error)?.message ?? err).slice(0, 500) } },
        json({ error: "internal" }, 500),
      );
    }

    try {
      await ingestDeps.onDataIngested(principal.userId, result.affectedDates);
    } catch (err) {
      log.error({ err, userId: principal.userId }, "ingest: onDataIngested hook failed");
    }

    const summary = buildSummary(n, {
      unknownFields,
      ...gzipInfo,
      rowsInserted: result.rowsInserted,
      rowsUpdated: result.rowsUpdated,
      nightsRecomputed: result.nightsRecomputed,
    });
    return finish(
      ctx,
      200,
      { summary, body: stored },
      json(
        {
          ok: true,
          days_written: n.days.length,
          date_range: summary.dateRange,
          last_sync_at: receivedAt.toISOString(),
          unknown_fields: Object.keys(unknownFields).sort(),
        },
        200,
      ),
    );
  } catch (err) {
    log.error({ err, userId: ctx?.principal.userId, ip, path }, "ingest: unexpected error");
    const res = json({ error: "internal" }, 500);
    if (!ctx) return res;
    return finish(ctx, 500, { errors: { reason: "internal", detail: String((err as Error)?.message ?? err).slice(0, 500) } }, res);
  }
}
