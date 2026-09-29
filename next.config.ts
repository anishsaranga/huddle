import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pino/pino-pretty are already auto-externalized by Next; listed explicitly for clarity.
  serverExternalPackages: ["pino", "pino-pretty", "postgres"],
};

export default nextConfig;
