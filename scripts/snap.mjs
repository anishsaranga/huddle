#!/usr/bin/env node

import { chromium, devices } from "playwright";
import fs from "fs";
import path from "path";

const args = process.argv.slice(2);
let pagePath = args[0];
let outDir = ".snaps/";
let times = "300,1200,3000";
let fullPage = false;

// Parse remaining arguments
for (let i = 1; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--full") {
    fullPage = true;
  } else if (/^[\d,\s]+$/.test(arg)) {
    times = arg;
  } else if (!outDir || outDir === ".snaps/") {
    outDir = arg;
  }
}

if (!pagePath) {
  console.error(
    "Usage: node scripts/snap.mjs <path> [outDir] [times] [--full]"
  );
  console.error("  path: Page path to navigate to (e.g., /home)");
  console.error(
    '  outDir: Output directory (default: .snaps/, will be created)'
  );
  console.error(
    "  times: Comma-separated delays in ms (default: 300,1200,3000)"
  );
  console.error("  --full: Capture full page (default: viewport height)");
  process.exit(1);
}

// Normalize outDir to ensure trailing slash
if (!outDir.endsWith("/") && !outDir.endsWith("\\")) {
  outDir = outDir + "/";
}

// Create output directory
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

// Parse times
const timeList = times.split(",").map((t) => parseInt(t.trim()));

// Create slug from path - ensure it starts with non-slash
const slug = pagePath
  .replace(/^[/\\]+/, "") // remove leading slashes
  .replace(/[/\\]/g, "-") // replace all slashes with dashes
  .replace(/-+$/, ""); // remove trailing dashes

const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";

// Ensure pagePath starts with /
if (!pagePath.startsWith("/")) {
  pagePath = "/" + pagePath;
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    ...devices["iPhone 15"],
    deviceScaleFactor: 2,
    colorScheme: "dark",
  });
  const page = await context.newPage();

  try {
    const fullURL = baseURL + pagePath;
    console.log(`Navigating to ${fullURL}`);
    await page.goto(fullURL, { waitUntil: "domcontentloaded" });

    for (let i = 0; i < timeList.length; i++) {
      const ms = timeList[i];
      const isLast = i === timeList.length - 1;

      // Wait for the specified time
      await page.waitForTimeout(ms);

      const filename = `${slug}-${ms}.png`;
      const filepath = path.join(outDir, filename);

      await page.screenshot({
        path: filepath,
        fullPage: isLast && fullPage,
      });

      console.log(`Saved: ${filepath}`);
    }
  } finally {
    await context.close();
    await browser.close();
  }
})();
