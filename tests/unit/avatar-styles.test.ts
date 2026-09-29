import * as collection from "@dicebear/collection";
import { describe, expect, it } from "vitest";
import { AVATAR_STYLES, humanizeValue, STYLE_IDS, STYLE_LIST } from "@/lib/avatar/styles";

type SchemaProp = { type?: string; items?: { enum?: string[]; pattern?: string } };

function schemaOf(key: string): Record<string, SchemaProp> {
  const style = (collection as unknown as Record<string, { schema?: { properties?: Record<string, SchemaProp> } }>)[key];
  expect(style, `@dicebear/collection has no export "${key}"`).toBeDefined();
  return style.schema?.properties ?? {};
}

describe("curated avatar styles", () => {
  it("offers about six styles, each with a license and attribution", () => {
    expect(STYLE_LIST.length).toBeGreaterThanOrEqual(6);
    expect(STYLE_LIST.length).toBeLessThanOrEqual(8);
    for (const s of STYLE_LIST) {
      expect(s.license.name).toBeTruthy();
      expect(s.license.url).toMatch(/^https:\/\//);
      expect(s.attribution).toContain(s.creator.name.split(" ")[0]);
    }
  });

  it("records the license each style package ships with", () => {
    for (const s of STYLE_LIST) {
      const meta = (collection as unknown as Record<string, { meta?: { license?: { name: string } } }>)[s.collectionKey].meta;
      expect(s.license.name).toBe(meta?.license?.name);
      expect(s.requiresAttribution).toBe(s.license.name === "CC BY 4.0");
    }
  });

  for (const id of STYLE_IDS) {
    it(`${id}: every curated option exists in the DiceBear schema`, () => {
      const def = AVATAR_STYLES[id];
      const props = schemaOf(def.collectionKey);
      const coreColor = new Set(["backgroundColor"]);
      const categoryIds = new Set<string>();
      for (const cat of def.categories) {
        expect(categoryIds.has(cat.id), `duplicate category ${cat.id}`).toBe(false);
        categoryIds.add(cat.id);
        expect(cat.variant || cat.colors?.length || cat.toggle, `${cat.id} is empty`).toBeTruthy();

        if (cat.variant) {
          const enumValues = props[cat.variant.option]?.items?.enum;
          expect(enumValues, `${id}.${cat.variant.option} is not an enum option`).toBeDefined();
          expect(new Set(cat.variant.values).size).toBe(cat.variant.values.length);
          for (const v of cat.variant.values) expect(enumValues).toContain(v);
          for (const v of cat.variant.randomPool ?? []) expect(cat.variant.values).toContain(v);
          for (const [k, v] of Object.entries(cat.variant.implies ?? {})) {
            expect(props[k]?.items?.enum).toContain(v);
          }
        }
        for (const c of cat.colors ?? []) {
          if (!coreColor.has(c.option)) {
            expect(props[c.option]?.type, `${id}.${c.option} is not a color array`).toBe("array");
            expect(props[c.option]?.items?.enum).toBeUndefined();
          }
          expect(c.palette.length).toBeGreaterThan(0);
          for (const hex of c.palette) expect(hex).toMatch(/^[0-9a-f]{6}$/);
          for (const hex of c.randomPool ?? []) expect(c.palette).toContain(hex);
        }
        if (cat.toggle) {
          expect(cat.toggle.option).toMatch(/Probability$/);
          expect(props[cat.toggle.option]?.type).toBe("integer");
          expect(cat.toggle.chance).toBeGreaterThanOrEqual(0);
          expect(cat.toggle.chance).toBeLessThanOrEqual(1);
        }
      }
      expect(categoryIds.has("background")).toBe(true);
    });
  }
});

describe("humanizeValue", () => {
  it("makes schema names readable", () => {
    expect(humanizeValue("variant07")).toBe("07");
    expect(humanizeValue("shortCombover")).toBe("Short combover");
    expect(humanizeValue("long12")).toBe("Long 12");
    expect(humanizeValue("smileLOL")).toBe("Smile lol");
  });
});
