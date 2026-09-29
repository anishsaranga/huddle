import type { StyleId } from "./styles";

export type AvatarOptionValue = string | number | boolean;

export type AvatarConfig = {
  v: 1;
  style: StyleId;
  seed: string;
  options: Record<string, AvatarOptionValue>;
};

/** FNV-1a 32-bit hash. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Stable key for caching / ETags (independent of option key order). */
export function configKey(config: AvatarConfig): string {
  const opts = Object.keys(config.options)
    .sort()
    .map((k) => `${k}=${String(config.options[k])}`)
    .join("&");
  return `v${config.v}|${config.style}|${config.seed}|${opts}`;
}

/** 16 hex chars from two independent 32-bit hashes; plenty for cache busting and ETags. */
export function configHash(config: AvatarConfig): string {
  const key = configKey(config);
  return hashString(key).toString(16).padStart(8, "0") + hashString(`${key}#`).toString(16).padStart(8, "0");
}
