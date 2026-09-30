// Generates the iOS launch screens (public/splash/*.png): ink background, a faint glow, the centred mark.
// Usage: npm run gen:splash
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { SPLASH_SCREENS, splashFile } from "../src/lib/pwa/splash";

const root = process.cwd();
async function main() {
  const outDir = path.join(root, "public", "splash");
  const icon = await readFile(path.join(root, "public", "icons", "icon.svg"));
  const BG = "#0A0B0D";

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  // The mark (icon.svg without its background), rendered large and resized per screen.
  const markSvg = Buffer.from(
    icon
      .toString()
      .replace(/<rect[^>]*\/>/, "")
      .replace('viewBox="0 0 512 512"', 'viewBox="84 84 344 344"'),
  );

  let total = 0;
  for (const s of SPLASH_SCREENS) {
    const markSize = Math.round(s.width * 0.34);
    const mark = await sharp(markSvg, { density: 384 }).resize(markSize, markSize).png().toBuffer();
    // Soft radial glow behind the mark.
    const glow = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${s.width}" height="${s.height}">
        <defs>
          <radialGradient id="g" cx="50%" cy="50%" r="50%">
            <stop offset="0" stop-color="#3D9BFF" stop-opacity="0.16"/>
            <stop offset="0.55" stop-color="#8C9BFF" stop-opacity="0.05"/>
            <stop offset="1" stop-color="#0A0B0D" stop-opacity="0"/>
          </radialGradient>
        </defs>
        <ellipse cx="${s.width / 2}" cy="${s.height / 2}" rx="${s.width * 0.75}" ry="${s.width * 0.75}" fill="url(#g)"/>
      </svg>`,
    );
    const file = path.join(root, "public", splashFile(s));
    const info = await sharp({ create: { width: s.width, height: s.height, channels: 3, background: BG } })
      .composite([
        { input: glow, top: 0, left: 0 },
        { input: mark, gravity: "centre" },
      ])
      .png({ palette: true, quality: 90, effort: 10, dither: 0.8 })
      .toFile(file);
    total += info.size;
    console.log(`${path.basename(file)}  ${(info.size / 1024).toFixed(0)} KB`);
  }
  console.log(`total ${(total / 1024).toFixed(0)} KB`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
