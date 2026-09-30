import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Separate build dir for the Playwright dev server (port 3200) so it can run
  // next to the regular `next dev` without fighting over `.next/dev/lock`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Keep the dev "N" badge from overlapping the tab bar during reviews.
  devIndicators: false,
  // pino/pino-pretty are already auto-externalized by Next; listed explicitly for clarity.
  serverExternalPackages: ["pino", "pino-pretty", "postgres"],
  // Baseline security headers on every route. HSTS is safe because the app is
  // only reached over HTTPS through the Cloudflare tunnel (browsers ignore it
  // on plain-HTTP localhost). No CSP: Next's inline bootstrap script and motion
  // need nonces/hashes, which is a separate, independently testable change.
  // Camera is off because avatar photos come from a file input, not getUserMedia.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
      {
        // The worker must always be revalidated so a deploy reaches installed apps promptly.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
