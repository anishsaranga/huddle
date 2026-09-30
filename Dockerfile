# Production image for Huddle: the Next.js web app, the background worker and the
# migration runner all ship in this one image (compose picks the command).
# Served behind a Cloudflare Tunnel at https://huddle.anishsaranga.com.
# Mirrors the house pattern from ../alpha-chat/Dockerfile.

# -- Stage 1: dependencies ------------------------------------------------------
FROM node:24-alpine AS deps
# sharp's prebuilt musl binaries (@img/sharp-linuxmusl-*) need libc6-compat's loader shims.
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# -- Stage 2: builder -----------------------------------------------------------
FROM node:24-alpine AS builder
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
# No DATABASE_URL (or any secret) is needed at build time: src/lib/env.ts parses
# lazily and src/db/index.ts connects on first use, so `next build` never touches Postgres.
RUN npm run build && npm run build:extras

# -- Stage 3: runner ------------------------------------------------------------
FROM node:24-alpine AS runner
RUN apk add --no-cache libc6-compat
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# .next/standalone (server.js + traced node_modules, incl. sharp and its musl
# binaries) does not include public/ or .next/static/, so both are copied in
# separately. dist/ holds the worker and migrate bundles; drizzle/ the SQL
# migrations (migrate.mjs reads ./drizzle relative to /app).
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/dist ./dist
COPY --from=builder --chown=nextjs:nodejs /app/drizzle ./drizzle

# Avatar uploads. Pre-created and chowned so the named volume mounted here
# inherits nextjs ownership on first use.
RUN mkdir -p /data/avatars && chown -R nextjs:nodejs /data

USER nextjs

EXPOSE 6060
ENV PORT=6060
# Bind all interfaces inside the container. Without this the standalone server
# listens on the container's own hostname only and compose's port mapping (the
# host-side loopback restriction) never reaches it.
ENV HOSTNAME="0.0.0.0"
ENV AVATAR_DIR=/data/avatars

CMD ["node", "server.js"]
