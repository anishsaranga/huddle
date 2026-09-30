import type { Metadata } from "next";

export const SITE_NAME = "Huddle";
/** Link-preview card (src/app/opengraph-image.tsx and twitter-image.tsx). */
export const OG_SIZE = { width: 1200, height: 630 } as const;
export const OG_ALT = "Huddle: recovery, strain and sleep, together. Private, invite only.";

export const SITE_DESCRIPTION = "Private fitness group app: recovery, strain and sleep, together.";

/**
 * Base for resolving relative metadata URLs (og:image, canonical). Read from
 * APP_URL when the metadata is evaluated: per request for dynamic pages, at
 * build time for prerendered ones (so build with APP_URL set in production).
 */
export function metadataBase(): URL {
  const raw = (process.env.APP_URL || "").trim();
  try {
    return new URL(raw || "http://localhost:3000");
  } catch {
    return new URL("http://localhost:3000");
  }
}

/**
 * Per-page metadata for public pages. Next replaces (not merges) the parent's
 * `openGraph`/`twitter` objects, so a page that sets its own repeats the shared
 * fields here, including the images (the file-convention images only attach to
 * the segment that declares them, and this page's object would replace that).
 */
export function publicPageMetadata(opts: { title: string; description: string; path: string }): Metadata {
  const full = `${opts.title} · ${SITE_NAME}`;
  return {
    title: opts.title,
    description: opts.description,
    alternates: { canonical: opts.path },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      locale: "en_US",
      title: full,
      description: opts.description,
      url: opts.path,
      images: [{ url: "/opengraph-image", ...OG_SIZE, alt: OG_ALT }],
    },
    twitter: {
      card: "summary_large_image",
      title: full,
      description: opts.description,
      images: [{ url: "/twitter-image", ...OG_SIZE, alt: OG_ALT }],
    },
  };
}
