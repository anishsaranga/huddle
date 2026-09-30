"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { FlairMap } from "@/lib/champions/flair";
import { CATEGORY_META, type ChampionCategory } from "@/lib/champions/types";
import { alpha } from "@/lib/ui/colors";

/*
 * Champion flair on avatars: the group page loads the active flair once
 * (getActiveFlair) and provides it here; Info rows, leaderboard rows and chat
 * avatars read it with useFlair(userId).
 */

const FlairContext = createContext<FlairMap>({});

export function FlairProvider({ flair, children }: { flair: FlairMap; children: ReactNode }) {
  return <FlairContext.Provider value={flair}>{children}</FlairContext.Provider>;
}

/** Categories `userId` currently holds (empty when none). */
export function useFlair(userId: string | null | undefined): ChampionCategory[] {
  const map = useContext(FlairContext);
  return (userId && map[userId]) || [];
}

/** The category to show: `prefer` if held (e.g. the board being viewed), else the first. */
export function primaryFlair(categories: readonly ChampionCategory[], prefer?: ChampionCategory): ChampionCategory | null {
  if (categories.length === 0) return null;
  return prefer && categories.includes(prefer) ? prefer : categories[0];
}

/** "Weekly champion: Best sleep, Most steps". */
export function flairLabel(categories: readonly ChampionCategory[]): string {
  return `Weekly champion: ${categories.map((c) => CATEGORY_META[c].title).join(", ")}`;
}

/** Solid trophy glyph (drawn in the page color on a colored chip). */
export function TrophyGlyph({ size = 10, color = "var(--bg)" }: { size?: number; color?: string }) {
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 24 24" style={{ fill: color }}>
      <path d="M6.5 2.5h11v1.3h3.2a.8.8 0 0 1 .8.8v1.6a5 5 0 0 1-4.6 5 5.5 5.5 0 0 1-3.9 3.2v2.6h2.7a1.5 1.5 0 0 1 1.5 1.5V21H6.8v-2.5a1.5 1.5 0 0 1 1.5-1.5H11v-2.6a5.5 5.5 0 0 1-3.9-3.2 5 5 0 0 1-4.6-5V4.6a.8.8 0 0 1 .8-.8h3.2zm11 3.1v3.9a3.2 3.2 0 0 0 2.2-3V5.6zm-11 0H4.3v.9a3.2 3.2 0 0 0 2.2 3z" />
    </svg>
  );
}

/**
 * Small trophy chip for an avatar's badge slot, in the category's color.
 * More than one title shows a count ("2").
 */
export function TrophyBadge({
  categories,
  prefer,
  size = 16,
  edge = "var(--bg)",
}: {
  categories: readonly ChampionCategory[];
  prefer?: ChampionCategory;
  size?: number;
  /** Color of the gap ring around the chip (the surface it sits on). */
  edge?: string;
}) {
  const primary = primaryFlair(categories, prefer);
  if (!primary) return null;
  const color = CATEGORY_META[primary].color;
  const extra = categories.length - 1;
  return (
    <span
      data-testid="champion-flair"
      data-category={primary}
      title={flairLabel(categories)}
      className="relative grid place-items-center rounded-full"
      style={{
        width: size,
        height: size,
        background: color,
        boxShadow: `0 0 0 2px ${edge}, 0 0 8px ${alpha(color, 55)}`,
      }}
    >
      <TrophyGlyph size={Math.round(size * 0.62)} />
      {extra > 0 && (
        <span
          aria-hidden
          className="num absolute -right-1.5 -top-1.5 grid h-[11px] min-w-[11px] place-items-center rounded-full bg-white px-[2px] font-mono text-[8px] font-bold leading-none text-bg"
          style={{ boxShadow: `0 0 0 1.5px ${edge}` }}
        >
          {extra + 1}
        </span>
      )}
    </span>
  );
}

/** The whole userId → categories map (for lists: look people up with `flairProps`). */
export function useFlairMap(): FlairMap {
  return useContext(FlairContext);
}

type FlairOpts = { prefer?: ChampionCategory; size?: number; edge?: string };
export type FlairProps = { ring?: string; badge?: ReactNode; label?: string };

/** Ring color + badge for an <Avatar>, or nothing when the user holds no title. */
export function useFlairProps(userId: string | null | undefined, opts: FlairOpts = {}): FlairProps {
  return flairProps(useFlair(userId), opts);
}

/** `useFlairProps` for a list row: `flairProps(map[userId] ?? [], …)`. */
export function flairProps(categories: readonly ChampionCategory[], opts: FlairOpts = {}): FlairProps {
  const primary = primaryFlair(categories, opts.prefer);
  if (!primary) return {};
  return {
    ring: CATEGORY_META[primary].color,
    badge: <TrophyBadge categories={categories} prefer={opts.prefer} size={opts.size} edge={opts.edge} />,
    label: flairLabel(categories),
  };
}
