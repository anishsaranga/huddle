import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Separate build dir for the Playwright dev server (port 3200) so it can run
  // next to the regular `next dev` without fighting over `.next/dev/lock`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Keep the dev "N" badge from overlapping the tab bar during reviews.
  devIndicators: false,
  // pino/pino-pretty are already auto-externalized by Next; listed explicitly for clarity.
  serverExternalPackages: ["pino", "pino-pretty", "postgres"],
};

export default nextConfig;
