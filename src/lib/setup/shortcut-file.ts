import { existsSync } from "node:fs";
import path from "node:path";

/** Where the admin drops the exported Shortcut, relative to the app root (Next serves public/ at "/"). */
export const SHORTCUT_FILE_REL = path.join("public", "shortcuts", "huddle-sync.shortcut");
/** The URL that file is served at (see the /shortcuts headers in next.config.ts). */
export const SHORTCUT_FILE_URL = "/shortcuts/huddle-sync.shortcut";

/**
 * The public URL of the exported Shortcut when the file is present under `baseDir`, else null.
 * Uncached; `baseDir` is injectable for tests. In the production image the server runs from /app with
 * the files in /app/public, so process.cwd() is the right base there too.
 */
export function resolveShortcutFileUrl(baseDir: string): string | null {
  return existsSync(path.join(baseDir, SHORTCUT_FILE_REL)) ? SHORTCUT_FILE_URL : null;
}

let cached: { url: string | null } | undefined;

/** resolveShortcutFileUrl(process.cwd()), checked once per process (adding the file means a redeploy). */
export function getShortcutFileUrl(): string | null {
  cached ??= { url: resolveShortcutFileUrl(process.cwd()) };
  return cached.url;
}
