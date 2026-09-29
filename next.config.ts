import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the dev "N" badge from overlapping the tab bar during reviews.
  devIndicators: false,
  // pino/pino-pretty are already auto-externalized by Next; listed explicitly for clarity.
  serverExternalPackages: ["pino", "pino-pretty", "postgres"],
};

export default nextConfig;
