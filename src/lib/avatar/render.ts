import { createAvatar, type Style } from "@dicebear/core";
// Named imports (not `* as`) so bundlers tree-shake the ~25 styles we don't use.
import { adventurer, avataaars, lorelei, micah, openPeeps, personas, toonHead } from "@dicebear/collection";
import { configKey, type AvatarConfig } from "./key";
import { AVATAR_STYLES, BACKGROUND_OPTION, optionSpecs, type StyleId } from "./styles";

/**
 * Local DiceBear rendering (no HTTP). Pure and synchronous, so it runs the
 * same on the server (API route, server components) and in the browser.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyStyle = Style<any>;

const DICEBEAR: Record<StyleId, AnyStyle> = {
  adventurer,
  avataaars,
  micah,
  "toon-head": toonHead,
  personas,
  "open-peeps": openPeeps,
  lorelei,
};

export type RenderOptions = {
  /** Output width/height in px. Omit for a size-less (fluid) SVG. */
  size?: number;
  /** Keep the license RDF <metadata> block (default true; inline UI drops it). */
  metadata?: boolean;
};

/** Map a stored config onto DiceBear's option shape. */
export function toDiceBearOptions(config: AvatarConfig): Record<string, unknown> {
  const specs = optionSpecs(config.style);
  const out: Record<string, unknown> = { seed: config.seed };
  for (const [key, value] of Object.entries(config.options)) {
    const spec = specs.get(key);
    if (!spec) continue;
    if (spec.kind === "toggle") out[key] = value ? 100 : 0;
    else out[key] = [String(value)];
  }
  if (!(BACKGROUND_OPTION in out)) out[BACKGROUND_OPTION] = ["transparent"];
  const frame = AVATAR_STYLES[config.style].frame;
  if (frame?.scale) out.scale = frame.scale;
  if (frame?.translateY) out.translateY = frame.translateY;
  return out;
}

const METADATA = /<metadata[\s\S]*?<\/metadata>/;

export function renderAvatarSvg(config: AvatarConfig, { size, metadata = true }: RenderOptions = {}): string {
  const style = DICEBEAR[config.style];
  const svg = createAvatar(style, { ...toDiceBearOptions(config), ...(size ? { size } : {}) }).toString();
  return metadata ? svg : svg.replace(METADATA, "");
}

// Small LRU so re-renders (and the customizer's many thumbnails) are free.
const MAX_CACHE = 600;
const uriCache = new Map<string, string>();

/**
 * `data:image/svg+xml` URI for `<img src>`. Using <img> (not inline SVG)
 * keeps each avatar's internal ids isolated and lets the browser rasterize
 * off the React tree. Memoized by config.
 */
export function avatarDataUri(config: AvatarConfig): string {
  const key = configKey(config);
  const hit = uriCache.get(key);
  if (hit !== undefined) {
    uriCache.delete(key);
    uriCache.set(key, hit);
    return hit;
  }
  const svg = renderAvatarSvg(config, { metadata: false });
  const uri = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  uriCache.set(key, uri);
  if (uriCache.size > MAX_CACHE) uriCache.delete(uriCache.keys().next().value!);
  return uri;
}
