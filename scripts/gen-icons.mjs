// Generates PNG app icons from public/icons/icon.svg.
// Usage: node scripts/gen-icons.mjs
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "public", "icons");
const svg = await readFile(path.join(outDir, "icon.svg"));
const BG = "#0A0B0D";

async function render(size) {
  // High density so the vector rasterizes crisply before resizing.
  return sharp(svg, { density: 384 }).resize(size, size).png().toBuffer();
}

for (const size of [180, 192, 512]) {
  await writeFile(path.join(outDir, `icon-${size}.png`), await render(size));
  console.log(`icon-${size}.png`);
}

// Maskable: full-bleed background, artwork scaled into the central safe zone (~72%).
const MASK = 512;
const inner = Math.round(MASK * 0.72);
const mark = await render(inner);
await sharp({
  create: { width: MASK, height: MASK, channels: 4, background: BG },
})
  .composite([{ input: mark, gravity: "centre" }])
  .png()
  .toFile(path.join(outDir, "icon-maskable-512.png"));
console.log("icon-maskable-512.png");
