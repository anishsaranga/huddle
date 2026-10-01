import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveShortcutFileUrl, SHORTCUT_FILE_URL } from "@/lib/setup/shortcut-file";

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), "huddle-shortcut-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("resolveShortcutFileUrl", () => {
  it("returns the public URL when public/shortcuts/huddle-sync.shortcut exists", () => {
    const base = tmp();
    mkdirSync(path.join(base, "public", "shortcuts"), { recursive: true });
    writeFileSync(path.join(base, "public", "shortcuts", "huddle-sync.shortcut"), "x");
    expect(resolveShortcutFileUrl(base)).toBe("/shortcuts/huddle-sync.shortcut");
    expect(SHORTCUT_FILE_URL).toBe("/shortcuts/huddle-sync.shortcut");
  });

  it("returns null when the file or its folder is missing", () => {
    const base = tmp();
    expect(resolveShortcutFileUrl(base)).toBeNull();
    mkdirSync(path.join(base, "public", "shortcuts"), { recursive: true });
    writeFileSync(path.join(base, "public", "shortcuts", ".gitkeep"), "");
    expect(resolveShortcutFileUrl(base)).toBeNull();
  });
});
