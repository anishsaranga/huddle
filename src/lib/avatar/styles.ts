/**
 * Curated DiceBear styles for Huddle avatars.
 *
 * Pure data (no DiceBear import), so it can be shared by server code, the
 * customizer and tests. Every option name and variant listed here is checked
 * against the real `@dicebear/collection` schema in
 * `tests/unit/avatar-styles.test.ts`, so a library upgrade that renames or
 * drops something fails loudly instead of producing broken configs.
 *
 * Licenses are copied from each style package's LICENSE file
 * (`node_modules/@dicebear/<style>/LICENSE`, v9.4.3) and DiceBear's license
 * table (https://www.dicebear.com/licenses/).
 */

/** A variant picker: one value from the style's enum (`option: [value]`). */
export type VariantPart = {
  option: string;
  values: readonly string[];
  /** Options forced alongside any pick (e.g. a shirt graphic needs the graphic shirt). */
  implies?: Readonly<Record<string, string>>;
  /** Subset random configs draw from (keeps dice rolls flattering). Default: all values. */
  randomPool?: readonly string[];
};

/** A color picker: a 6-digit lowercase hex (no `#`). `palette` is the suggested swatches. */
export type ColorPart = {
  option: string;
  label: string;
  palette: readonly string[];
  /** Subset random configs draw from. Default: the palette. */
  randomPool?: readonly string[];
};

/** An on/off switch backed by a DiceBear `…Probability` option (stored as a boolean). */
export type TogglePart = {
  option: string;
  label: string;
  /** Chance (0–1) the feature is on in a random config. */
  chance: number;
};

export type AvatarCategory = {
  id: string;
  /** Short tab label. */
  label: string;
  variant?: VariantPart;
  colors?: readonly ColorPart[];
  toggle?: TogglePart;
  /** Zoom thumbnails onto the face (small facial features). */
  zoom?: boolean;
};

export type AvatarStyleDef = {
  /** Stored in configs. Never rename. */
  id: StyleId;
  /** Export name in `@dicebear/collection`. */
  collectionKey: string;
  name: string;
  /** One-line vibe for the style picker. */
  tagline: string;
  source: { title: string; url: string };
  creator: { name: string; url: string };
  license: { name: string; url: string };
  /** CC BY 4.0 styles must be credited. */
  requiresAttribution: boolean;
  /** Human-readable attribution line for the credits page. */
  attribution: string;
  categories: readonly AvatarCategory[];
  /** Center of the face (fractions of the square) — zoomed thumbnails center on it. */
  faceCenter: readonly [number, number];
  /** Render tweaks so every style sits similarly inside a circle. */
  frame?: { scale?: number; translateY?: number };
};

export const STYLE_IDS = [
  "adventurer",
  "avataaars",
  "micah",
  "toon-head",
  "personas",
  "open-peeps",
  "lorelei",
] as const;
export type StyleId = (typeof STYLE_IDS)[number];

/** Background swatches tuned for the ink-black UI: soft pastels + deep tones. */
export const BACKGROUND_PALETTE = [
  "b6e3f4", // sky
  "c0aede", // lavender
  "d1d4f9", // periwinkle
  "ffd5dc", // blush
  "ffdfbf", // peach
  "c7f0d8", // mint
  "f4e7b8", // butter
  "e3e6ec", // fog
  "3d9bff", // strain blue
  "2bd67b", // recovery green
  "2a3140", // slate
  "3a2d4d", // plum
  "1f3a36", // pine
  "4a2a2c", // oxblood
] as const;

/** Pastels only — what random configs pick from (the deep tones are opt-in). */
export const RANDOM_BACKGROUNDS = BACKGROUND_PALETTE.slice(0, 8);

export const BACKGROUND_OPTION = "backgroundColor";

const background: AvatarCategory = {
  id: "background",
  label: "Background",
  colors: [{ option: BACKGROUND_OPTION, label: "Background", palette: BACKGROUND_PALETTE }],
};

/** Natural sort so grids read short01, short02… instead of schema order. */
const nat = (values: readonly string[]) =>
  [...values].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));

const range = (prefix: string, n: number) =>
  Array.from({ length: n }, (_, i) => `${prefix}${String(i + 1).padStart(2, "0")}`);

/** Skin-tone ramp for Lorelei (its own palette is white). Stops before tones too dark for its black line art. */
const SKIN_RAMP = ["ffffff", "fde7d6", "f6d2b8", "ecc19c", "d9a57e", "c68b62", "ad7550", "956243"];
/** Hair/ink colors for line-art styles. */
const INK_RAMP = ["000000", "2c1b18", "4a312c", "724133", "a55728", "b58143", "d6b370", "c93305", "e8e1e1", "6b7fd7", "e279c7", "3eac2c"];

const CC_BY = { name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/" };
const CC0 = { name: "CC0 1.0", url: "https://creativecommons.org/publicdomain/zero/1.0/" };

function credit(title: string, creator: string, license: { name: string }): string {
  return `“${title}” by ${creator}, licensed under ${license.name}. Remixed by DiceBear.`;
}

export const AVATAR_STYLES: Record<StyleId, AvatarStyleDef> = {
  adventurer: {
    id: "adventurer",
    collectionKey: "adventurer",
    name: "Adventurer",
    tagline: "Bold anime-ish heroes",
    source: { title: "Adventurer", url: "https://www.figma.com/community/file/1184595184137881796" },
    creator: { name: "Lisa Wischofsky", url: "https://www.instagram.com/lischi_art/" },
    license: CC_BY,
    requiresAttribution: true,
    attribution: credit("Adventurer", "Lisa Wischofsky", CC_BY),
    faceCenter: [0.5, 0.58],
    categories: [
      { id: "skin", label: "Skin", colors: [{ option: "skinColor", label: "Skin tone", palette: ["f2d3b1", "ecad80", "9e5622", "763900"] }] },
      {
        id: "hair",
        label: "Hair",
        variant: {
          option: "hair",
          values: nat([...range("short", 19), ...range("long", 26)]),
        },
        colors: [
          {
            option: "hairColor",
            label: "Hair color",
            palette: ["0e0e0e", "562306", "6a4e35", "796a45", "ac6511", "cb6820", "ab2a18", "b9a05f", "e5d7a3", "afafaf", "3eac2c", "85c2c6", "dba3be", "592454"],
          },
        ],
        toggle: { option: "hairProbability", label: "Hair", chance: 0.97 },
      },
      { id: "eyes", label: "Eyes", zoom: true, variant: { option: "eyes", values: range("variant", 26) } },
      { id: "brows", label: "Brows", zoom: true, variant: { option: "eyebrows", values: range("variant", 15) } },
      { id: "mouth", label: "Mouth", zoom: true, variant: { option: "mouth", values: range("variant", 30) } },
      {
        id: "glasses",
        label: "Glasses",
        zoom: true,
        variant: { option: "glasses", values: range("variant", 5) },
        toggle: { option: "glassesProbability", label: "Glasses", chance: 0.2 },
      },
      {
        id: "earrings",
        label: "Earrings",
        variant: { option: "earrings", values: range("variant", 6) },
        toggle: { option: "earringsProbability", label: "Earrings", chance: 0.2 },
      },
      {
        id: "features",
        label: "Details",
        zoom: true,
        variant: { option: "features", values: ["blush", "freckles", "birthmark", "mustache"] },
        toggle: { option: "featuresProbability", label: "Face details", chance: 0.25 },
      },
      background,
    ],
  },

  avataaars: {
    id: "avataaars",
    collectionKey: "avataaars",
    name: "Avataaars",
    tagline: "Classic, most wardrobe",
    source: { title: "Avataaars", url: "https://avataaars.com/" },
    creator: { name: "Pablo Stanley", url: "https://twitter.com/pablostanley" },
    license: { name: "Free for personal and commercial use", url: "https://avataaars.com/" },
    requiresAttribution: false,
    attribution: "“Avataaars” by Pablo Stanley, free for personal and commercial use. Remixed by DiceBear.",
    faceCenter: [0.5, 0.47],
    frame: { translateY: 4 },
    categories: [
      {
        id: "skin",
        label: "Skin",
        colors: [{ option: "skinColor", label: "Skin tone", palette: ["ffdbb4", "edb98a", "fd9841", "f8d25c", "d08b5b", "ae5d29", "614335"] }],
      },
      {
        id: "hair",
        label: "Hair",
        variant: {
          option: "top",
          values: [
            "bigHair", "bob", "bun", "curly", "curvy", "dreads", "dreads01", "dreads02", "frida", "frizzle", "fro", "froBand",
            "longButNotTooLong", "miaWallace", "shavedSides", "straight01", "straight02", "straightAndStrand", "shaggy",
            "shaggyMullet", "shortCurly", "shortFlat", "shortRound", "shortWaved", "sides", "theCaesar", "theCaesarAndSidePart",
            "hat", "hijab", "turban", "winterHat1", "winterHat02", "winterHat03", "winterHat04",
          ],
        },
        colors: [
          { option: "hairColor", label: "Hair color", palette: ["2c1b18", "4a312c", "724133", "a55728", "b58143", "d6b370", "c93305", "f59797", "ecdcbf", "e8e1e1"] },
          { option: "hatColor", label: "Hat & scarf", palette: ["262e33", "3c4f5c", "25557c", "5199e4", "65c9ff", "b1e2ff", "a7ffc4", "ffffb1", "ffdeb5", "ffafb9", "ff488e", "ff5c5c", "929598", "e6e6e6", "ffffff"] },
        ],
        toggle: { option: "topProbability", label: "Hair", chance: 0.97 },
      },
      { id: "eyes", label: "Eyes", zoom: true, variant: { option: "eyes", values: ["default", "happy", "wink", "winkWacky", "squint", "side", "surprised", "eyeRoll", "hearts", "closed", "cry", "xDizzy"], randomPool: ["default", "happy", "wink", "squint", "side", "surprised"] } },
      {
        id: "brows",
        label: "Brows",
        zoom: true,
        variant: {
          option: "eyebrows",
          values: ["defaultNatural", "flatNatural", "raisedExcitedNatural", "angryNatural", "frownNatural", "sadConcernedNatural", "upDownNatural", "unibrowNatural", "default", "raisedExcited", "angry", "sadConcerned", "upDown"],
          randomPool: ["defaultNatural", "flatNatural", "raisedExcitedNatural", "upDownNatural", "default", "raisedExcited"],
        },
      },
      { id: "mouth", label: "Mouth", zoom: true, variant: { option: "mouth", values: ["default", "smile", "twinkle", "tongue", "serious", "eating", "concerned", "disbelief", "grimace", "sad", "screamOpen", "vomit"], randomPool: ["default", "smile", "twinkle", "tongue", "serious"] } },
      {
        id: "beard",
        label: "Beard",
        variant: { option: "facialHair", values: ["beardLight", "beardMedium", "beardMajestic", "moustacheFancy", "moustacheMagnum"] },
        colors: [{ option: "facialHairColor", label: "Beard color", palette: ["2c1b18", "4a312c", "724133", "a55728", "b58143", "d6b370", "c93305", "f59797", "ecdcbf", "e8e1e1"] }],
        toggle: { option: "facialHairProbability", label: "Facial hair", chance: 0.2 },
      },
      {
        id: "glasses",
        label: "Glasses",
        zoom: true,
        variant: { option: "accessories", values: ["prescription01", "prescription02", "round", "kurt", "wayfarers", "sunglasses", "eyepatch"] },
        colors: [{ option: "accessoriesColor", label: "Frame color", palette: ["262e33", "3c4f5c", "25557c", "5199e4", "65c9ff", "a7ffc4", "ffffb1", "ffafb9", "ff488e", "ff5c5c", "929598", "ffffff"] }],
        toggle: { option: "accessoriesProbability", label: "Glasses", chance: 0.2 },
      },
      {
        id: "clothes",
        label: "Outfit",
        variant: {
          option: "clothing",
          values: ["hoodie", "shirtCrewNeck", "shirtVNeck", "shirtScoopNeck", "collarAndSweater", "blazerAndShirt", "blazerAndSweater", "overall", "graphicShirt"],
        },
        colors: [{ option: "clothesColor", label: "Outfit color", palette: ["262e33", "3c4f5c", "25557c", "5199e4", "65c9ff", "b1e2ff", "a7ffc4", "ffffb1", "ffafb9", "ff488e", "ff5c5c", "929598", "e6e6e6", "ffffff"] }],
      },
      {
        id: "graphic",
        label: "Tee print",
        variant: {
          option: "clothingGraphic",
          values: ["bat", "bear", "cumbia", "deer", "diamond", "hola", "pizza", "resist", "skull", "skullOutline"],
          implies: { clothing: "graphicShirt" },
        },
      },
      background,
    ],
  },

  micah: {
    id: "micah",
    collectionKey: "micah",
    name: "Micah",
    tagline: "Clean editorial portraits",
    source: { title: "Avatar Illustration System", url: "https://www.figma.com/community/file/829741575478342595" },
    creator: { name: "Micah Lanier", url: "https://dribbble.com/micahlanier" },
    license: CC_BY,
    requiresAttribution: true,
    attribution: credit("Avatar Illustration System", "Micah Lanier", CC_BY),
    faceCenter: [0.6, 0.41],
    categories: [
      { id: "skin", label: "Skin", colors: [{ option: "baseColor", label: "Skin tone", palette: ["f9c9b6", "ac6651", "77311d"] }] },
      {
        id: "hair",
        label: "Hair",
        variant: { option: "hair", values: ["fonze", "mrT", "dougFunny", "mrClean", "dannyPhantom", "full", "pixie", "turban"], randomPool: ["fonze", "mrT", "dougFunny", "dannyPhantom", "full", "pixie"] },
        colors: [
          {
            option: "hairColor",
            label: "Hair color",
            palette: ["000000", "77311d", "ac6651", "f4d150", "ffeba4", "f9c9b6", "fc909f", "ffedef", "e0ddff", "9287ff", "6bd9e9", "d2eff3", "ffffff"],
          },
        ],
        toggle: { option: "hairProbability", label: "Hair", chance: 0.95 },
      },
      {
        id: "eyes",
        label: "Eyes",
        zoom: true,
        variant: { option: "eyes", values: ["eyes", "round", "smiling", "eyesShadow", "smilingShadow"] },
        colors: [{ option: "eyeShadowColor", label: "Eye shadow", palette: ["d2eff3", "e0ddff", "ffeba4", "ffedef", "ffffff"] }],
      },
      { id: "brows", label: "Brows", zoom: true, variant: { option: "eyebrows", values: ["up", "down", "eyelashesUp", "eyelashesDown"] } },
      { id: "mouth", label: "Mouth", zoom: true, variant: { option: "mouth", values: ["smile", "laughing", "smirk", "surprised", "nervous", "pucker", "sad", "frown"], randomPool: ["smile", "laughing", "smirk"] } },
      { id: "nose", label: "Nose", zoom: true, variant: { option: "nose", values: ["curve", "pointed", "tound"] } },
      { id: "ears", label: "Ears", variant: { option: "ears", values: ["attached", "detached"] } },
      {
        id: "beard",
        label: "Beard",
        variant: { option: "facialHair", values: ["beard", "scruff"] },
        toggle: { option: "facialHairProbability", label: "Facial hair", chance: 0.15 },
      },
      {
        id: "glasses",
        label: "Glasses",
        zoom: true,
        variant: { option: "glasses", values: ["round", "square"] },
        colors: [
          { option: "glassesColor", label: "Frame color", palette: ["000000", "77311d", "ac6651", "f4d150", "fc909f", "9287ff", "6bd9e9", "d2eff3", "ffffff"] },
        ],
        toggle: { option: "glassesProbability", label: "Glasses", chance: 0.25 },
      },
      {
        id: "earrings",
        label: "Earrings",
        variant: { option: "earrings", values: ["stud", "hoop"] },
        colors: [
          { option: "earringColor", label: "Earring color", palette: ["000000", "f4d150", "ffeba4", "fc909f", "9287ff", "6bd9e9", "d2eff3", "ffffff"] },
        ],
        toggle: { option: "earringsProbability", label: "Earrings", chance: 0.25 },
      },
      {
        id: "shirt",
        label: "Shirt",
        variant: { option: "shirt", values: ["crew", "collared", "open"] },
        colors: [
          {
            option: "shirtColor",
            label: "Shirt color",
            palette: ["000000", "77311d", "ac6651", "f4d150", "ffeba4", "f9c9b6", "fc909f", "ffedef", "e0ddff", "9287ff", "6bd9e9", "d2eff3", "ffffff"],
          },
        ],
      },
      background,
    ],
  },

  "toon-head": {
    id: "toon-head",
    collectionKey: "toonHead",
    name: "Toon Head",
    tagline: "Chunky cartoon characters",
    source: { title: "ToonHead", url: "https://www.figma.com/community/file/1589627891082866389" },
    creator: { name: "Johan Melin", url: "https://www.johanmelin.com" },
    license: CC_BY,
    requiresAttribution: true,
    attribution: credit("ToonHead", "Johan Melin", CC_BY),
    faceCenter: [0.5, 0.45],
    categories: [
      { id: "skin", label: "Skin", colors: [{ option: "skinColor", label: "Skin tone", palette: ["f1c3a5", "c68e7a", "b98e6a", "a36b4f", "5c3829"] }] },
      {
        id: "hair",
        label: "Hair",
        variant: { option: "hair", values: ["sideComed", "undercut", "spiky", "bun"] },
        colors: [{ option: "hairColor", label: "Hair color", palette: ["2c1b18", "724133", "a55728", "b58143", "d6b370", "e8e1e1", "c93305", "e279c7", "6b7fd7"] }],
        toggle: { option: "hairProbability", label: "Hair", chance: 0.95 },
      },
      {
        id: "long-hair",
        label: "Long hair",
        variant: { option: "rearHair", values: ["neckHigh", "shoulderHigh", "longStraight", "longWavy"] },
        toggle: { option: "rearHairProbability", label: "Long hair", chance: 0.4 },
      },
      { id: "eyes", label: "Eyes", zoom: true, variant: { option: "eyes", values: ["happy", "wide", "wink", "humble", "bow"] } },
      { id: "brows", label: "Brows", zoom: true, variant: { option: "eyebrows", values: ["neutral", "happy", "raised", "angry", "sad"], randomPool: ["neutral", "happy", "raised"] } },
      { id: "mouth", label: "Mouth", zoom: true, variant: { option: "mouth", values: ["smile", "laugh", "agape", "sad", "angry"], randomPool: ["smile", "laugh"] } },
      {
        id: "beard",
        label: "Beard",
        variant: { option: "beard", values: ["chin", "chinMoustache", "fullBeard", "longBeard", "moustacheTwirl"] },
        toggle: { option: "beardProbability", label: "Beard", chance: 0.3 },
      },
      {
        id: "clothes",
        label: "Outfit",
        variant: { option: "clothes", values: ["tShirt", "shirt", "turtleNeck", "openJacket", "dress"] },
        colors: [
          { option: "clothesColor", label: "Outfit color", palette: ["151613", "545454", "e8e9e6", "b11f1f", "f97316", "eab308", "147f3c", "0b3286", "731ac3", "ec4899"] },
        ],
      },
      background,
    ],
  },

  personas: {
    id: "personas",
    collectionKey: "personas",
    name: "Personas",
    tagline: "Soft, friendly minis",
    source: { title: "Personas by Draftbit", url: "https://personas.draftbit.com/" },
    creator: { name: "Draftbit", url: "https://draftbit.com/" },
    license: CC_BY,
    requiresAttribution: true,
    attribution: credit("Personas", "Draftbit (draftbit.com)", CC_BY),
    faceCenter: [0.5, 0.44],
    frame: { scale: 112, translateY: 5 },
    categories: [
      { id: "skin", label: "Skin", colors: [{ option: "skinColor", label: "Skin tone", palette: ["eeb4a4", "e7a391", "e5a07e", "d78774", "b16a5b", "92594b", "623d36"] }] },
      {
        id: "hair",
        label: "Hair",
        variant: {
          option: "hair",
          values: [
            "buzzcut", "fade", "shortCombover", "shortComboverChops", "sideShave", "mohawk", "curlyHighTop", "curly", "bobCut",
            "bobBangs", "long", "extraLong", "pigtails", "curlyBun", "straightBun", "bunUndercut", "balding", "bald", "cap", "beanie",
          ],
        },
        colors: [{ option: "hairColor", label: "Hair color", palette: ["362c47", "6c4545", "e15c66", "e16381", "f27d65", "f29c65", "dee1f5"] }],
      },
      { id: "eyes", label: "Eyes", zoom: true, variant: { option: "eyes", values: ["open", "happy", "wink", "sleep", "glasses", "sunglasses"] } },
      { id: "mouth", label: "Mouth", zoom: true, variant: { option: "mouth", values: ["smile", "bigSmile", "smirk", "lips", "surprise", "frown", "pacifier"], randomPool: ["smile", "bigSmile", "smirk", "lips"] } },
      { id: "nose", label: "Nose", zoom: true, variant: { option: "nose", values: ["smallRound", "mediumRound", "wrinkles"] } },
      {
        id: "beard",
        label: "Beard",
        variant: { option: "facialHair", values: ["shadow", "goatee", "soulPatch", "pyramid", "walrus", "beardMustache"] },
        toggle: { option: "facialHairProbability", label: "Facial hair", chance: 0.2 },
      },
      {
        id: "body",
        label: "Outfit",
        variant: { option: "body", values: ["rounded", "squared", "small", "checkered"] },
        colors: [{ option: "clothingColor", label: "Outfit color", palette: ["456dff", "54d7c7", "7555ca", "6dbb58", "e24553", "f3b63a", "f55d81"] }],
      },
      background,
    ],
  },

  "open-peeps": {
    id: "open-peeps",
    collectionKey: "openPeeps",
    name: "Open Peeps",
    tagline: "Hand-drawn, big expressions",
    source: { title: "Open Peeps", url: "https://www.openpeeps.com/" },
    creator: { name: "Pablo Stanley", url: "https://twitter.com/pablostanley" },
    license: CC0,
    requiresAttribution: false,
    attribution: credit("Open Peeps", "Pablo Stanley", CC0),
    faceCenter: [0.6, 0.56],
    categories: [
      { id: "skin", label: "Skin", colors: [{ option: "skinColor", label: "Skin tone", palette: ["ffdbb4", "edb98a", "d08b5b", "ae5d29", "694d3d"] }] },
      {
        id: "hair",
        label: "Hair",
        variant: {
          option: "head",
          values: nat([
            "afro", "bangs", "bangs2", "bantuKnots", "bear", "bun", "bun2", "buns", "cornrows", "cornrows2", "dreads1", "dreads2",
            "flatTop", "flatTopLong", "grayBun", "grayMedium", "grayShort", "hatBeanie", "hatHip", "hijab", "long", "longAfro",
            "longBangs", "longCurly", "medium1", "medium2", "medium3", "mediumBangs", "mediumBangs2", "mediumBangs3", "mediumStraight",
            "mohawk", "mohawk2", "noHair1", "noHair2", "noHair3", "pomp", "shaved1", "shaved2", "shaved3", "short1", "short2", "short3",
            "short4", "short5", "turban", "twists", "twists2",
          ]),
        },
        colors: [{ option: "headContrastColor", label: "Hair color", palette: ["2c1b18", "4a312c", "724133", "a55728", "b58143", "d6b370", "c93305", "f59797", "ecdcbf", "e8e1e1"] }],
      },
      {
        id: "face",
        label: "Expression",
        zoom: true,
        variant: {
          option: "face",
          values: [
            "smile", "smileBig", "smileLOL", "smileTeethGap", "cute", "calm", "cheeky", "lovingGrin1", "lovingGrin2", "eatingHappy",
            "explaining", "driven", "serious", "blank", "awe", "eyesClosed", "old", "solemn", "suspicious", "tired", "veryAngry",
            "rage", "angryWithFang", "contempt", "concerned", "concernedFear", "fear", "hectic", "monster", "cyclops",
          ],
          randomPool: ["smile", "smileBig", "smileLOL", "smileTeethGap", "cute", "calm", "cheeky", "lovingGrin1", "lovingGrin2", "driven", "serious"],
        },
      },
      {
        id: "beard",
        label: "Beard",
        variant: { option: "facialHair", values: nat(["chin", "full", "full2", "full3", "full4", "goatee1", "goatee2", "moustache1", "moustache2", "moustache3", "moustache4", "moustache5", "moustache6", "moustache7", "moustache8", "moustache9"]) },
        toggle: { option: "facialHairProbability", label: "Facial hair", chance: 0.2 },
      },
      {
        id: "glasses",
        label: "Glasses",
        zoom: true,
        variant: { option: "accessories", values: ["glasses", "glasses2", "glasses3", "glasses4", "glasses5", "sunglasses", "sunglasses2", "eyepatch"] },
        toggle: { option: "accessoriesProbability", label: "Glasses", chance: 0.25 },
      },
      {
        id: "mask",
        label: "Mask",
        variant: { option: "mask", values: ["medicalMask", "respirator"] },
        toggle: { option: "maskProbability", label: "Mask", chance: 0.03 },
      },
      { id: "clothes", label: "Outfit", colors: [{ option: "clothingColor", label: "Outfit color", palette: ["e78276", "ffcf77", "fdea6b", "78e185", "9ddadb", "8fa7df", "e279c7"] }] },
      background,
    ],
  },

  lorelei: {
    id: "lorelei",
    collectionKey: "lorelei",
    name: "Lorelei",
    tagline: "Elegant line art",
    source: { title: "Lorelei", url: "https://www.figma.com/community/file/1198749693280469639" },
    creator: { name: "Lisa Wischofsky", url: "https://www.instagram.com/lischi_art/" },
    license: CC0,
    requiresAttribution: false,
    attribution: credit("Lorelei", "Lisa Wischofsky", CC0),
    faceCenter: [0.5, 0.52],
    categories: [
      {
        id: "skin",
        label: "Skin",
        variant: { option: "head", values: range("variant", 4) },
        colors: [{ option: "skinColor", label: "Skin tone", palette: SKIN_RAMP }],
      },
      {
        id: "hair",
        label: "Hair",
        variant: { option: "hair", values: range("variant", 48) },
        colors: [{ option: "hairColor", label: "Hair color", palette: INK_RAMP, randomPool: INK_RAMP.slice(0, 9) }],
      },
      { id: "eyes", label: "Eyes", zoom: true, variant: { option: "eyes", values: range("variant", 24) } },
      { id: "brows", label: "Brows", zoom: true, variant: { option: "eyebrows", values: range("variant", 13) } },
      {
        id: "mouth",
        label: "Mouth",
        zoom: true,
        variant: {
          option: "mouth",
          values: [...range("happy", 18), ...range("sad", 9)],
          randomPool: range("happy", 18),
        },
      },
      { id: "nose", label: "Nose", zoom: true, variant: { option: "nose", values: range("variant", 6) } },
      {
        id: "glasses",
        label: "Glasses",
        zoom: true,
        variant: { option: "glasses", values: range("variant", 5) },
        toggle: { option: "glassesProbability", label: "Glasses", chance: 0.2 },
      },
      {
        id: "earrings",
        label: "Earrings",
        variant: { option: "earrings", values: range("variant", 3) },
        toggle: { option: "earringsProbability", label: "Earrings", chance: 0.2 },
      },
      {
        id: "beard",
        label: "Beard",
        variant: { option: "beard", values: range("variant", 2) },
        toggle: { option: "beardProbability", label: "Beard", chance: 0.1 },
      },
      {
        id: "freckles",
        label: "Freckles",
        variant: { option: "freckles", values: ["variant01"] },
        toggle: { option: "frecklesProbability", label: "Freckles", chance: 0.15 },
      },
      {
        id: "flowers",
        label: "Flowers",
        variant: { option: "hairAccessories", values: ["flowers"] },
        toggle: { option: "hairAccessoriesProbability", label: "Hair flowers", chance: 0.08 },
      },
      background,
    ],
  },
};

export const STYLE_LIST: readonly AvatarStyleDef[] = STYLE_IDS.map((id) => AVATAR_STYLES[id]);

export function isStyleId(value: unknown): value is StyleId {
  return typeof value === "string" && (STYLE_IDS as readonly string[]).includes(value);
}

export type OptionKind = "variant" | "color" | "toggle";

export type OptionSpec =
  | { kind: "variant"; values: readonly string[] }
  | { kind: "color" }
  | { kind: "toggle" };

const specCache = new Map<StyleId, ReadonlyMap<string, OptionSpec>>();

/** Every option a stored config may set for this style, keyed by DiceBear option name. */
export function optionSpecs(style: StyleId): ReadonlyMap<string, OptionSpec> {
  let specs = specCache.get(style);
  if (!specs) {
    const m = new Map<string, OptionSpec>();
    for (const cat of AVATAR_STYLES[style].categories) {
      if (cat.variant) {
        const prev = m.get(cat.variant.option);
        m.set(cat.variant.option, {
          kind: "variant",
          values: prev?.kind === "variant" ? [...prev.values, ...cat.variant.values] : cat.variant.values,
        });
      }
      for (const c of cat.colors ?? []) m.set(c.option, { kind: "color" });
      if (cat.toggle) m.set(cat.toggle.option, { kind: "toggle" });
    }
    specs = m;
    specCache.set(style, specs);
  }
  return specs;
}

export function findCategory(style: StyleId, categoryId: string): AvatarCategory | undefined {
  return AVATAR_STYLES[style].categories.find((c) => c.id === categoryId);
}

/** "shortCombover" → "Short combover", "variant07" → "07", "long12" → "Long 12". */
export function humanizeValue(value: string): string {
  const v = value.replace(/^variant/, "");
  if (/^\d+$/.test(v)) return v;
  const spaced = v
    .replace(/([a-z])([A-Z0-9])/g, "$1 $2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Categories whose thumbnails would be hidden behind glasses. */
const EYE_AREA = new Set(["eyes", "brows", "face"]);

/**
 * Options forced off in a category's thumbnails so the feature being picked
 * is visible (e.g. no sunglasses while choosing eyes). Preview only; the
 * saved config keeps whatever the user chose.
 */
export function previewOverrides(style: StyleId, categoryId: string): Record<string, boolean> {
  if (!EYE_AREA.has(categoryId)) return {};
  const glasses = findCategory(style, "glasses")?.toggle?.option;
  return glasses ? { [glasses]: false } : {};
}
