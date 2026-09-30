// Bundles the two non-Next entry points for the production image:
//   dist/worker.mjs  <- src/worker/index.ts   (background jobs)
//   dist/migrate.mjs <- scripts/migrate.ts    (drizzle migrations; reads ./drizzle)
// Run by the Dockerfile after `next build`; also usable locally: `npm run build:extras`.
import { build } from "esbuild";

/** `server-only` throws outside Next's react-server condition; the worker/migrate are plain Node. */
const serverOnlyShim = {
  name: "server-only-shim",
  setup(b) {
    b.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "shim" }));
    b.onLoad({ filter: /.*/, namespace: "shim" }, () => ({ contents: "export {};", loader: "js" }));
  },
};

await build({
  entryPoints: {
    worker: "src/worker/index.ts",
    migrate: "scripts/migrate.ts",
  },
  outdir: "dist",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  // `@/` -> `src/` comes from tsconfig.json "paths" (esbuild reads it).
  tsconfig: "tsconfig.json",
  // sharp ships native binaries (per-libc optional packages); pg-native is an optional
  // postgres/pg peer we never use. Everything else (postgres, pino, node-cron, zod,
  // drizzle-orm) is bundled so the runner needs no extra node_modules for these.
  // pino only spawns a worker-thread transport when `transport` is set, and src/lib/log.ts
  // sets it only outside production (pino-pretty), so nothing thread-based is needed at runtime.
  external: ["sharp", "pg-native"],
  plugins: [serverOnlyShim],
  // Bundled CommonJS dependencies (pino, node-cron deps) call require() on Node builtins.
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  legalComments: "none",
  logLevel: "info",
});
