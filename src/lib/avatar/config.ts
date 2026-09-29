import { z } from "zod";
import { hashString, type AvatarConfig, type AvatarOptionValue } from "./key";
import {
  AVATAR_STYLES,
  BACKGROUND_OPTION,
  findCategory,
  optionSpecs,
  RANDOM_BACKGROUNDS,
  STYLE_IDS,
  type AvatarCategory,
  type StyleId,
} from "./styles";

/**
 * Stored avatar config (`users.avatar_config`). Validated against the chosen
 * style's curated schema, so anything that passes is always renderable.
 *
 * Option values:
 *  - variant: one of the curated enum values (rendered as `option: [value]`)
 *  - color:   6-digit lowercase hex, no `#`
 *  - toggle:  boolean (rendered as the DiceBear `…Probability` 100 / 0)
 */
export type { AvatarConfig, AvatarOptionValue } from "./key";

const HEX = /^[0-9a-f]{6}$/;

export const AvatarConfigSchema = z
  .object({
    v: z.literal(1),
    style: z.enum(STYLE_IDS),
    seed: z.string().min(1).max(64),
    options: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  })
  .strict()
  .superRefine((cfg, ctx) => {
    const specs = optionSpecs(cfg.style);
    for (const [key, value] of Object.entries(cfg.options)) {
      const spec = specs.get(key);
      const path = ["options", key];
      if (!spec) {
        ctx.addIssue({ code: "custom", path, message: `Unknown option "${key}" for style ${cfg.style}` });
        continue;
      }
      const ok =
        spec.kind === "variant"
          ? typeof value === "string" && spec.values.includes(value)
          : spec.kind === "color"
            ? typeof value === "string" && HEX.test(value)
            : typeof value === "boolean";
      if (!ok) {
        ctx.addIssue({ code: "custom", path, message: `Invalid value for ${key}: ${JSON.stringify(value)}` });
      }
    }
  });

/** Parse unknown JSON (e.g. from the DB); null when it isn't a valid config. */
export function parseAvatarConfig(input: unknown): AvatarConfig | null {
  const r = AvatarConfigSchema.safeParse(input);
  return r.success ? (r.data as AvatarConfig) : null;
}

export function isValidAvatarConfig(input: unknown): input is AvatarConfig {
  return AvatarConfigSchema.safeParse(input).success;
}

// ---------------------------------------------------------------------------
// Deterministic randomness
// ---------------------------------------------------------------------------

export type Rng = () => number;

/** Small, fast seeded PRNG (mulberry32). */
export function seededRng(seed: string): Rng {
  let a = hashString(seed) || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(rng: Rng, arr: readonly T[]): T => arr[Math.floor(rng() * arr.length) % arr.length];

/** Pick something other than `current` when there is a choice. */
function pickDifferent<T>(rng: Rng, arr: readonly T[], current: unknown): T {
  if (arr.length < 2) return arr[0];
  const others = arr.filter((v) => v !== current);
  return pick(rng, others.length ? others : arr);
}

export function randomSeed(rng: Rng = Math.random): string {
  return Math.floor(rng() * 36 ** 8)
    .toString(36)
    .padStart(8, "0");
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

/**
 * Roll one category into `into`. Whole-avatar rolls draw from each part's
 * flattering `randomPool`; a category shuffle (`current` given) explores the
 * full range and always lands on something new.
 */
function rollCategory(
  cat: AvatarCategory,
  rng: Rng,
  into: Record<string, AvatarOptionValue>,
  current?: Record<string, AvatarOptionValue>,
) {
  if (cat.variant) {
    const pool = current ? cat.variant.values : (cat.variant.randomPool ?? cat.variant.values);
    into[cat.variant.option] = pickDifferent(rng, pool, current?.[cat.variant.option]);
  }
  for (const c of cat.colors ?? []) {
    const pool = current
      ? c.palette
      : c.option === BACKGROUND_OPTION
        ? RANDOM_BACKGROUNDS
        : (c.randomPool ?? c.palette);
    into[c.option] = pickDifferent(rng, pool, current?.[c.option]);
  }
  if (cat.toggle) into[cat.toggle.option] = rng() < cat.toggle.chance;
}

/** A fully specified random config (every curated option set). */
export function randomConfig(style?: StyleId, rng: Rng = Math.random, seed?: string): AvatarConfig {
  const s = style ?? pick(rng, STYLE_IDS);
  const options: Record<string, AvatarOptionValue> = {};
  for (const cat of AVATAR_STYLES[s].categories) {
    // `implies` categories (e.g. tee print) only set their own option here.
    rollCategory(cat, rng, options);
  }
  return { v: 1, style: s, seed: seed ?? randomSeed(rng), options };
}

/**
 * Re-roll one category. Shuffling an optional feature (glasses, beard…)
 * switches it on so the shuffle is visible.
 */
export function randomizeCategory(config: AvatarConfig, categoryId: string, rng: Rng = Math.random): AvatarConfig {
  const cat = findCategory(config.style, categoryId);
  if (!cat) return config;
  const options = { ...config.options };
  rollCategory(cat, rng, options, config.options);
  if (cat.toggle) {
    const single = !cat.variant || cat.variant.values.length < 2;
    options[cat.toggle.option] = single ? !config.options[cat.toggle.option] : true;
  }
  if (cat.variant?.implies) Object.assign(options, cat.variant.implies);
  return { ...config, options };
}

/**
 * Fill every missing curated option deterministically from the seed, so a
 * partial config always has a concrete value per control.
 */
export function completeConfig(config: AvatarConfig): AvatarConfig {
  const full = randomConfig(config.style, seededRng(`${config.style}:${config.seed}`), config.seed);
  return { ...config, options: { ...full.options, ...config.options } };
}

/** Switch style: that style's seed-derived defaults, same seed, keep the background. */
export function switchStyle(config: AvatarConfig, style: StyleId): AvatarConfig {
  const bg = config.options[BACKGROUND_OPTION];
  const next = completeConfig({ v: 1, style, seed: config.seed, options: {} });
  if (typeof bg === "string") next.options[BACKGROUND_OPTION] = bg;
  return next;
}

/** Default avatar for a new user: style and features derived from the seed. */
export function defaultConfigForSeed(seed: string): AvatarConfig {
  const safeSeed = seed.slice(0, 64) || "huddle";
  const rng = seededRng(`default:${safeSeed}`);
  // Stick to the most universally flattering styles for first impressions.
  const style = pick(rng, ["adventurer", "avataaars", "micah", "toon-head"] as const);
  return completeConfig({ v: 1, style, seed: safeSeed, options: {} });
}

/** Set one option; applies a variant's `implies` and switches its toggle on. */
export function setOption(
  config: AvatarConfig,
  cat: AvatarCategory,
  option: string,
  value: AvatarOptionValue,
): AvatarConfig {
  const options = { ...config.options, [option]: value };
  if (cat.variant && option === cat.variant.option) {
    if (cat.toggle) options[cat.toggle.option] = true;
    if (cat.variant.implies) Object.assign(options, cat.variant.implies);
  }
  return { ...config, options };
}

export { configHash, configKey, hashString } from "./key";
// Rendering lives in ./render (renderAvatarSvg, avatarDataUri) so validation and
// the random helpers can be imported without pulling in the DiceBear styles.
