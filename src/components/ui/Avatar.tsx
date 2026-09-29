import type { CSSProperties, ReactNode } from "react";
import { configHash, hashString, type AvatarConfig } from "@/lib/avatar/key";
import { alpha } from "@/lib/ui/colors";

/*
 * No "use client" and no hooks: <Avatar> renders the same from server and
 * client components. It deliberately does NOT import the DiceBear styles
 * (~430 KB gzipped): a user's DiceBear avatar is the SVG from
 * /api/avatar/:id, versioned by config hash (?v=…) so the browser caches it
 * for good. To draw a config locally (customizer, previews, credits) use
 * <ConfigAvatar> from components/avatar/ConfigAvatar, which passes `src`.
 */

/** Up to two initials from a name or email. */
export function initialsOf(label: string): string {
  const base = label.includes("@") ? label.split("@")[0] : label;
  const words = base.split(/[\s._-]+/).filter(Boolean);
  if (words.length === 0) return "?";
  const letters =
    words.length === 1 ? words[0].slice(0, 2) : words[0].slice(0, 1) + words[words.length - 1].slice(0, 1);
  return letters.toUpperCase();
}

export const AVATAR_SIZES = { xs: 20, sm: 28, md: 40, lg: 48, xl: 96 } as const;
export type AvatarSize = keyof typeof AVATAR_SIZES;

/** Anything user-shaped: a `users` row, a session user, or a trimmed DTO. */
export type AvatarUser = {
  id?: string | null;
  displayName?: string | null;
  name?: string | null;
  username?: string | null;
  email?: string | null;
  avatarKind?: "dicebear" | "upload" | null;
  avatarConfig?: unknown;
  avatarPath?: string | null;
  /** Explicit image URL (overrides the /api/avatar URL). */
  avatarUrl?: string | null;
};

export type AvatarProps = {
  user?: AvatarUser | null;
  /** Fallback label (initials) when there is no user or avatar. */
  label?: string;
  /** Explicit image (e.g. a locally rendered DiceBear data URI). Wins over `user`. */
  src?: string | null;
  size?: AvatarSize | number;
  /** Signal color for a flair ring + soft glow (champions, leaderboard). */
  ring?: string;
  /** Small element pinned to the bottom-right (e.g. a rank or trophy chip). */
  badge?: ReactNode;
  /** Accessible name. Without it the avatar is decorative (aria-hidden). */
  alt?: string;
  className?: string;
  style?: CSSProperties;
};

export function userLabel(user?: AvatarUser | null, fallback = "?"): string {
  return user?.displayName || user?.name || user?.username || user?.email || fallback;
}

/** Loose shape check only; the API validates (and falls back) server-side. */
function looksLikeConfig(raw: unknown): raw is AvatarConfig {
  if (!raw || typeof raw !== "object") return false;
  const c = raw as Record<string, unknown>;
  return typeof c.style === "string" && typeof c.seed === "string" && !!c.options && typeof c.options === "object";
}

/**
 * Cache-busted /api/avatar URL for a user, or null when they have no avatar
 * (then <Avatar> shows initials). The version changes whenever the stored
 * config or upload does.
 */
export function avatarUrl(user: AvatarUser | null | undefined): string | null {
  if (!user) return null;
  if (user.avatarUrl) return user.avatarUrl;
  if (!user.id) return null;
  if (user.avatarKind === "upload" && user.avatarPath) {
    return `/api/avatar/${user.id}?v=u${hashString(user.avatarPath).toString(36)}`;
  }
  if (user.avatarKind !== "upload" && looksLikeConfig(user.avatarConfig)) {
    return `/api/avatar/${user.id}?v=${configHash(user.avatarConfig)}`;
  }
  return null;
}

/**
 * User avatar: DiceBear character, uploaded photo, or initials — always a
 * crisp circle. DiceBear avatars are SVG `<img>`s, sharp at any size, with
 * each one's internal ids isolated.
 */
export function Avatar({ user, label, src, size = "md", ring, badge, alt, className = "", style }: AvatarProps) {
  const px = typeof size === "number" ? size : AVATAR_SIZES[size];
  const image = src ?? avatarUrl(user);
  const isPhoto = !src && user?.avatarKind === "upload";
  const inline = !!image?.startsWith("data:");
  const text = label ?? userLabel(user);

  // Flair ring: a hairline gap in the page color, the signal ring, then a soft glow.
  const ringW = px >= 64 ? 3 : 2;
  const gap = px >= 64 ? 3 : 2;
  const ringStyle: CSSProperties | undefined = ring
    ? {
        boxShadow: `0 0 0 ${gap}px var(--bg), 0 0 0 ${gap + ringW}px ${ring}, 0 0 ${Math.round(px * 0.35)}px ${Math.round(px * 0.04)}px ${alpha(ring, 45)}`,
      }
    : undefined;

  const a11y = alt ? { role: "img" as const, "aria-label": alt } : { "aria-hidden": true as const };

  return (
    <span
      {...a11y}
      className={`relative inline-flex shrink-0 select-none rounded-full ${className}`}
      style={{ width: px, height: px, ...ringStyle, ...style }}
    >
      <span className="absolute inset-0 overflow-hidden rounded-full bg-[linear-gradient(160deg,#2a2e35,#1a1d22)]">
        {!image ? (
          <span
            className="flex size-full items-center justify-center font-display font-semibold tracking-[0.04em] text-text-2"
            style={{ fontSize: Math.max(9, Math.round(px * 0.34)) }}
          >
            {initialsOf(text)}
          </span>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- data: URIs / private API; next/image adds nothing here.
          <img
            src={image}
            alt=""
            width={px}
            height={px}
            draggable={false}
            decoding="async"
            loading={inline ? undefined : "lazy"}
            className={`block size-full ${isPhoto ? "object-cover" : ""}`}
          />
        )}
        {/* Hairline edge so light backgrounds don't bleed into the page. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-full shadow-[inset_0_0_0_1px_var(--hairline-strong)]"
        />
      </span>
      {badge && (
        <span className="absolute -bottom-0.5 -right-0.5 flex items-center justify-center">{badge}</span>
      )}
    </span>
  );
}

type AvatarStackProps = {
  people: { id: string; label: string; user?: AvatarUser | null; src?: string | null }[];
  /** Total members, to show a "+N" chip for the ones not drawn. */
  total?: number;
  size?: "sm" | "md";
};

/** Overlapping avatars with an optional "+N" overflow chip. */
export function AvatarStack({ people, total, size = "sm" }: AvatarStackProps) {
  const extra = total !== undefined ? Math.max(total - people.length, 0) : 0;
  return (
    <span className="flex items-center" aria-hidden>
      {people.map((p, i) => (
        <Avatar
          key={p.id}
          user={p.user}
          src={p.src}
          label={p.label}
          size={size}
          className={`ring-2 ring-card ${i > 0 ? "-ml-2" : ""}`}
        />
      ))}
      {extra > 0 && (
        <span
          className={`num -ml-2 inline-flex items-center justify-center rounded-full bg-card-sunken font-mono text-[10px] text-muted ring-2 ring-card ${
            size === "sm" ? "size-7" : "size-10"
          }`}
        >
          +{extra}
        </span>
      )}
    </span>
  );
}
