import { z } from "zod";

/** Treat empty strings (e.g. `KEY=` in .env) as unset. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), schema.optional());

const withDefault = <T extends z.ZodType>(schema: T, def: z.output<T>) =>
  z.preprocess((v) => (v === "" ? undefined : v), schema.default(def as never));

const schema = z.object({
  DATABASE_URL: optional(z.string()),
  AUTH_SECRET: optional(z.string()),
  AUTH_GOOGLE_ID: optional(z.string()),
  AUTH_GOOGLE_SECRET: optional(z.string()),
  ADMIN_EMAIL: optional(z.string()),
  API_KEY_PEPPER: optional(z.string()),
  APP_URL: optional(z.string()),
  GEMINI_API_KEY: optional(z.string()),
  GEMINI_MODEL: optional(z.string()),
  SHORTCUT_NAME: withDefault(z.string(), "Huddle Sync"),
  SHORTCUT_ICLOUD_URL: optional(z.url()),
  LOG_LEVEL: withDefault(
    z.enum(["trace", "debug", "info", "warn", "error", "fatal"]),
    "info",
  ),
  /** Uploaded avatar photos. Default ./data/avatars (dev) or /data/avatars (production). */
  AVATAR_DIR: optional(z.string()),
  INGEST_LOG_RETENTION_DAYS: withDefault(z.coerce.number().int().positive(), 90),
  NODE_ENV: withDefault(z.enum(["development", "production", "test"]), "development"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/**
 * Parse and validate server env lazily, once. Nothing is parsed at import
 * time, so `next build` works without runtime-only variables present.
 */
export function getEnv(): Env {
  if (!cached) {
    const result = schema.safeParse(process.env);
    if (!result.success) {
      const problems = result.error.issues
        .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("\n");
      throw new Error(`Invalid environment configuration:\n${problems}`);
    }
    cached = result.data;
  }
  return cached;
}

/** Get a variable that must be present at the point of use. */
export function requireEnv(name: keyof Env): string {
  const value = getEnv()[name];
  if (value === undefined || value === "") {
    throw new Error(
      `Missing required environment variable ${name}. Set it in .env (see .env.example).`,
    );
  }
  return String(value);
}
