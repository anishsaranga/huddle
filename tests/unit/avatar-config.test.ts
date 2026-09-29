import { describe, expect, it } from "vitest";
import {
  AvatarConfigSchema,
  completeConfig,
  configHash,
  defaultConfigForSeed,
  isValidAvatarConfig,
  parseAvatarConfig,
  randomConfig,
  randomizeCategory,
  seededRng,
  setOption,
  switchStyle,
  type AvatarConfig,
} from "@/lib/avatar/config";
import { avatarDataUri, renderAvatarSvg, toDiceBearOptions } from "@/lib/avatar/render";
import { AVATAR_STYLES, findCategory, STYLE_IDS } from "@/lib/avatar/styles";

const base: AvatarConfig = {
  v: 1,
  style: "adventurer",
  seed: "maya",
  options: { hair: "short03", hairColor: "0e0e0e", glassesProbability: true },
};

describe("AvatarConfigSchema", () => {
  it("accepts a valid config", () => {
    expect(AvatarConfigSchema.safeParse(base).success).toBe(true);
    expect(parseAvatarConfig(base)).toEqual(base);
  });

  it("accepts empty options (seed decides)", () => {
    expect(isValidAvatarConfig({ ...base, options: {} })).toBe(true);
  });

  it("rejects an unknown style", () => {
    expect(isValidAvatarConfig({ ...base, style: "bottts" })).toBe(false);
    expect(isValidAvatarConfig({ ...base, style: "" })).toBe(false);
  });

  it("rejects an unknown option", () => {
    const r = AvatarConfigSchema.safeParse({ ...base, options: { ...base.options, laserEyes: "on" } });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].path).toEqual(["options", "laserEyes"]);
  });

  it("rejects an option that belongs to another style", () => {
    // `top` is avataaars' hair, not adventurer's.
    expect(isValidAvatarConfig({ ...base, options: { top: "bob" } })).toBe(false);
  });

  it("rejects bad values", () => {
    expect(isValidAvatarConfig({ ...base, options: { hair: "variant99" } })).toBe(false);
    expect(isValidAvatarConfig({ ...base, options: { hair: 3 } })).toBe(false);
    expect(isValidAvatarConfig({ ...base, options: { hairColor: "#0e0e0e" } })).toBe(false);
    expect(isValidAvatarConfig({ ...base, options: { hairColor: "red" } })).toBe(false);
    expect(isValidAvatarConfig({ ...base, options: { hairColor: "0E0E0E" } })).toBe(false);
    expect(isValidAvatarConfig({ ...base, options: { glassesProbability: 100 } })).toBe(false);
    expect(isValidAvatarConfig({ ...base, options: { glassesProbability: "yes" } })).toBe(false);
  });

  it("rejects wrong version, missing seed, extra keys and junk", () => {
    expect(isValidAvatarConfig({ ...base, v: 2 })).toBe(false);
    expect(isValidAvatarConfig({ ...base, seed: "" })).toBe(false);
    expect(isValidAvatarConfig({ ...base, seed: "x".repeat(65) })).toBe(false);
    expect(isValidAvatarConfig({ ...base, extra: true })).toBe(false);
    expect(parseAvatarConfig(null)).toBeNull();
    expect(parseAvatarConfig("adventurer")).toBeNull();
  });
});

describe("randomConfig", () => {
  for (const style of STYLE_IDS) {
    it(`${style}: 200 random configs all validate and set every control`, () => {
      const rng = seededRng(`test:${style}`);
      const optionCount = new Set(
        AVATAR_STYLES[style].categories.flatMap((c) => [
          ...(c.variant ? [c.variant.option] : []),
          ...(c.colors ?? []).map((x) => x.option),
          ...(c.toggle ? [c.toggle.option] : []),
        ]),
      ).size;
      for (let i = 0; i < 200; i++) {
        const cfg = randomConfig(style, rng);
        const r = AvatarConfigSchema.safeParse(cfg);
        expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
        expect(Object.keys(cfg.options)).toHaveLength(optionCount);
      }
    });
  }

  it("picks a random style when none is given", () => {
    const rng = seededRng("styles");
    const seen = new Set(Array.from({ length: 200 }, () => randomConfig(undefined, rng).style));
    expect(seen.size).toBe(STYLE_IDS.length);
  });
});

describe("randomizeCategory", () => {
  it("only changes the category's own options and keeps it valid", () => {
    const cfg = randomConfig("avataaars", seededRng("a"));
    const next = randomizeCategory(cfg, "hair", seededRng("b"));
    expect(next.options.top).not.toBe(cfg.options.top);
    expect(next.options.mouth).toBe(cfg.options.mouth);
    expect(next.options.clothing).toBe(cfg.options.clothing);
    expect(isValidAvatarConfig(next)).toBe(true);
  });

  it("switches an optional feature on when shuffled", () => {
    const cfg = { ...randomConfig("adventurer", seededRng("c")), style: "adventurer" as const };
    cfg.options.glassesProbability = false;
    expect(randomizeCategory(cfg, "glasses").options.glassesProbability).toBe(true);
  });

  it("applies implied options (tee print needs the graphic tee)", () => {
    const cfg = randomConfig("avataaars", seededRng("d"));
    cfg.options.clothing = "hoodie";
    expect(randomizeCategory(cfg, "graphic").options.clothing).toBe("graphicShirt");
  });

  it("ignores unknown categories", () => {
    expect(randomizeCategory(base, "wings")).toBe(base);
  });
});

describe("helpers", () => {
  it("defaultConfigForSeed is deterministic, complete and valid", () => {
    const a = defaultConfigForSeed("anish");
    expect(defaultConfigForSeed("anish")).toEqual(a);
    expect(isValidAvatarConfig(a)).toBe(true);
    expect(a.seed).toBe("anish");
    expect(Object.keys(a.options).length).toBeGreaterThan(5);
    expect(isValidAvatarConfig(defaultConfigForSeed(""))).toBe(true);
    expect(isValidAvatarConfig(defaultConfigForSeed("y".repeat(100)))).toBe(true);
  });

  it("completeConfig keeps explicit options", () => {
    const full = completeConfig(base);
    expect(full.options.hair).toBe("short03");
    expect(full.options.eyes).toBeDefined();
    expect(isValidAvatarConfig(full)).toBe(true);
  });

  it("switchStyle keeps seed and background", () => {
    const cfg = setOption(completeConfig(base), findCategory("adventurer", "background")!, "backgroundColor", "3a2d4d");
    const next = switchStyle(cfg, "micah");
    expect(next.style).toBe("micah");
    expect(next.seed).toBe("maya");
    expect(next.options.backgroundColor).toBe("3a2d4d");
    expect(isValidAvatarConfig(next)).toBe(true);
  });

  it("setOption turns the feature's toggle on", () => {
    const cfg = { ...base, options: { ...base.options, glassesProbability: false } };
    const next = setOption(cfg, findCategory("adventurer", "glasses")!, "glasses", "variant03");
    expect(next.options).toMatchObject({ glasses: "variant03", glassesProbability: true });
  });

  it("configHash ignores key order and changes with content", () => {
    const a = { ...base, options: { hair: "short03", hairColor: "0e0e0e" } };
    const b = { ...base, options: { hairColor: "0e0e0e", hair: "short03" } };
    expect(configHash(a)).toBe(configHash(b));
    expect(configHash(a)).toMatch(/^[0-9a-f]{16}$/);
    expect(configHash({ ...a, seed: "other" })).not.toBe(configHash(a));
  });
});

describe("renderAvatarSvg", () => {
  for (const style of STYLE_IDS) {
    it(`${style}: renders an <svg>`, () => {
      const cfg = randomConfig(style, seededRng(style));
      const svg = renderAvatarSvg(cfg, { size: 64 });
      expect(svg.startsWith("<svg")).toBe(true);
      expect(svg).toContain('width="64"');
      expect(svg).toContain("<metadata");
      expect(renderAvatarSvg(cfg, { metadata: false })).not.toContain("<metadata");
    });
  }

  it("maps toggles to probabilities and variants to one-item arrays", () => {
    const opts = toDiceBearOptions({ ...base, options: { hair: "short03", glassesProbability: false } });
    expect(opts).toMatchObject({ seed: "maya", hair: ["short03"], glassesProbability: 0 });
  });

  it("is deterministic and cached as a data URI", () => {
    const cfg = randomConfig("lorelei", seededRng("x"));
    expect(renderAvatarSvg(cfg)).toBe(renderAvatarSvg(cfg));
    const uri = avatarDataUri(cfg);
    expect(uri.startsWith("data:image/svg+xml;utf8,%3Csvg")).toBe(true);
    expect(avatarDataUri(cfg)).toBe(uri);
  });

  it("applies the background color", () => {
    const svg = renderAvatarSvg({ ...base, options: { backgroundColor: "3a2d4d" } });
    expect(svg.toLowerCase()).toContain("#3a2d4d");
  });
});

describe("avatarUrl (light <Avatar>)", () => {
  it("versions DiceBear and upload URLs, and falls back to initials", async () => {
    const { avatarUrl } = await import("@/components/ui/Avatar");
    const id = "11111111-1111-4111-8111-111111111111";
    expect(avatarUrl({ id, avatarKind: "dicebear", avatarConfig: base })).toBe(`/api/avatar/${id}?v=${configHash(base)}`);
    const up = avatarUrl({ id, avatarKind: "upload", avatarPath: "a.webp" });
    expect(up?.startsWith(`/api/avatar/${id}?v=u`)).toBe(true);
    expect(avatarUrl({ id, avatarKind: "upload", avatarPath: "b.webp" })).not.toBe(up);
    expect(avatarUrl({ id })).toBeNull();
    expect(avatarUrl({ avatarKind: "dicebear", avatarConfig: base })).toBeNull();
    expect(avatarUrl({ id, avatarConfig: "junk" })).toBeNull();
    expect(avatarUrl({ id, avatarUrl: "/x.png" })).toBe("/x.png");
  });
});
