import pino from "pino";

const SENSITIVE = [
  "req.headers.authorization",
  "req.headers.cookie",
  "headers.authorization",
  "headers.cookie",
  "authorization",
  "cookie",
  "apiKey",
  "api_key",
  "key",
  "token",
  "password",
];

const REDACT_PATHS = [...SENSITIVE, ...SENSITIVE.map((p) => `*.${p}`)];

const level = process.env.LOG_LEVEL || "info";
const isProd = process.env.NODE_ENV === "production";

export const logger = pino({
  level,
  redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
  ...(isProd
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "SYS:HH:MM:ss.l", ignore: "pid,hostname" },
        },
      }),
});

/** Per-module child logger, e.g. `childLogger("ingest")`. */
export function childLogger(module: string) {
  return logger.child({ module });
}

/** Pathname only, never the query string or hash. Safe to log. */
export function safePath(url: string | URL): string {
  if (url instanceof URL) return url.pathname;
  try {
    return new URL(url, "http://localhost").pathname;
  } catch {
    return url.split(/[?#]/)[0];
  }
}
