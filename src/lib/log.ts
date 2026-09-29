import pino, { type DestinationStream, type Logger } from "pino";

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

/** Options every Huddle logger shares (level and redaction). */
export const baseLoggerOptions = {
  level,
  redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
} satisfies pino.LoggerOptions;

/**
 * A logger with the app's redaction rules writing to `destination` (tests
 * capture output this way). Without a destination it's the app logger.
 */
export function createLogger(destination?: DestinationStream, opts: { level?: string } = {}): Logger {
  if (destination) return pino({ ...baseLoggerOptions, level: opts.level ?? level }, destination);
  return pino({
    ...baseLoggerOptions,
    ...(isProd
      ? {}
      : {
          transport: {
            target: "pino-pretty",
            options: { colorize: true, translateTime: "SYS:HH:MM:ss.l", ignore: "pid,hostname" },
          },
        }),
  });
}

export const logger = createLogger();

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
