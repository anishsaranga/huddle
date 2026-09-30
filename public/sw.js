/* Huddle service worker. Plain JS (served as-is from /public, scope "/").
 *
 * What it does:
 *   - Precaches /offline plus the hashed CSS/JS/font files and icons that page needs, so
 *     the offline screen is fully styled with no network.
 *   - cache-first for immutable assets (/_next/static/*, /icons/*, fonts).
 *   - network-first for navigations; if the network fails (or the tunnel/origin
 *     answers 502/503/504/52x) it serves the cached /offline page.
 *
 * What it never does: cache /api/* (ingest, me, groups streams, auth), other
 * same-origin requests (RSC payloads, images) or any HTML besides /offline.
 * Nothing user-specific is ever written to a cache.
 *
 * Bump VERSION to invalidate every cache (old ones are deleted on activate).
 */
const VERSION = "v1";
const SHELL_CACHE = `huddle-shell-${VERSION}`;
const STATIC_CACHE = `huddle-static-${VERSION}`;
const OFFLINE_URL = "/offline";
const PRECACHE_STATIC = ["/icons/icon.svg", "/icons/icon-192.png"];
const MAX_STATIC_ENTRIES = 250;

/**
 * Decide how to handle a request: "navigate" (network-first, offline fallback),
 * "static" (cache-first) or "bypass" (don't touch it).
 */
function classify(url, request, origin) {
  if (request.method !== "GET") return "bypass";
  if (url.origin !== origin) return "bypass";
  const p = url.pathname;
  if (p === "/api" || p.startsWith("/api/")) return "bypass";
  if (request.mode === "navigate") return "navigate";
  if (p.startsWith("/_next/static/") || p.startsWith("/icons/")) return "static";
  if (request.destination === "font") return "static";
  return "bypass";
}

/** Origin/tunnel outage responses that should fall back to the offline page (not app 500s). */
function isServerDown(status) {
  return status === 502 || status === 503 || status === 504 || status >= 520;
}

/** Same-origin hashed asset URLs mentioned in a page's HTML/RSC payload or a stylesheet. */
function extractAssetUrls(text) {
  const found = new Set();
  const re = /\/_next\/static\/[A-Za-z0-9_\-./%~+@\[\]]+\.(?:js|css|woff2?|ttf|otf|png|svg|jpg|webp|avif)/g;
  let m;
  while ((m = re.exec(text))) found.add(m[0]);
  return [...found];
}

async function trim(cache, max) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

async function putStatic(url) {
  const cache = await caches.open(STATIC_CACHE);
  if (await cache.match(url)) return;
  const res = await fetch(url);
  if (!res.ok) return;
  await cache.put(url, res.clone());
  if (url.endsWith(".css")) {
    // Fonts referenced from the stylesheet (next/font) are not in the HTML.
    const css = await res.text();
    await Promise.allSettled(extractAssetUrls(css).map(putStatic));
  }
}

/** (Re)build the offline shell: the page plus every asset it references. */
async function precacheShell() {
  const shell = await caches.open(SHELL_CACHE);
  const res = await fetch(OFFLINE_URL, { cache: "reload" });
  if (!res.ok) throw new Error(`offline page answered ${res.status}`);
  const html = await res.clone().text();
  await shell.put(OFFLINE_URL, res);
  await Promise.allSettled([...PRECACHE_STATIC, ...extractAssetUrls(html)].map(putStatic));
}

async function offlineFallback() {
  const cached = await caches.match(OFFLINE_URL, { cacheName: SHELL_CACHE });
  return cached || new Response("You're offline.", { status: 503, headers: { "Content-Type": "text/plain" } });
}

async function handleNavigation(request) {
  try {
    const res = await fetch(request);
    if (isServerDown(res.status)) return offlineFallback();
    return res;
  } catch {
    return offlineFallback();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok && res.type === "basic") {
    await cache.put(request, res.clone());
    await trim(cache, MAX_STATIC_ENTRIES);
  }
  return res;
}

if (typeof self.addEventListener === "function") {
  // No skipWaiting here: a waiting worker is applied when the user taps "Update available".
  self.addEventListener("install", (event) => {
    event.waitUntil(precacheShell());
  });

  self.addEventListener("activate", (event) => {
    event.waitUntil(
      (async () => {
        const keep = new Set([SHELL_CACHE, STATIC_CACHE]);
        for (const name of await caches.keys()) {
          if (name.startsWith("huddle-") && !keep.has(name)) await caches.delete(name);
        }
        await self.clients.claim();
      })(),
    );
  });

  self.addEventListener("fetch", (event) => {
    const request = event.request;
    const kind = classify(new URL(request.url), request, self.location.origin);
    if (kind === "navigate") event.respondWith(handleNavigation(request));
    else if (kind === "static") event.respondWith(cacheFirst(request));
  });

  self.addEventListener("message", (event) => {
    const type = event.data && event.data.type;
    if (type === "SKIP_WAITING") self.skipWaiting();
    // The page asks for a refresh of the offline shell now and then (the worker file itself rarely changes).
    if (type === "REFRESH_SHELL") event.waitUntil(precacheShell().catch(() => {}));
  });
}

// Lets tests load this file in a plain Node context.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { classify, isServerDown, extractAssetUrls, VERSION };
}
