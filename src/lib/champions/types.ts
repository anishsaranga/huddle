/**
 * Weekly champions: shared types, category metadata and the stored message
 * payload (pure, client-safe; no database or env access).
 */

import type { AvatarConfig, AvatarKind, ChampionCategory } from "@/db/schema";
import { shortDate } from "@/lib/dashboard/dates";
import { addDays } from "@/lib/tz";

export type { ChampionCategory };

/** Category order everywhere (card, prompt, template, flair priority). */
export const CHAMPION_CATEGORIES: readonly ChampionCategory[] = ["recovery", "strain", "sleep", "steps", "improved"];

export type CategoryMeta = {
  /** Short label, e.g. "Recovery". */
  label: string;
  /** Title for the award, e.g. "Best recovery". */
  title: string;
  /** Unit of the stored value ("%", "", "steps", "pts"). */
  unit: string;
  /** What the value is, for the AI facts (e.g. "average recovery %"). */
  stat: string;
  /** Signal color (CSS). Steps have no signal color, so they get a neutral white. */
  color: string;
  emoji: string;
  /** Board tab this category jumps to (week period), if any. */
  board: "recovery" | "strain" | "sleep" | null;
  /** Decimals shown. */
  decimals: number;
};

export const CATEGORY_META: Record<ChampionCategory, CategoryMeta> = {
  recovery: {
    label: "Recovery",
    title: "Best recovery",
    unit: "%",
    stat: "average recovery score (0-100%)",
    color: "var(--recovery-green)",
    emoji: "💚",
    board: "recovery",
    decimals: 1,
  },
  strain: {
    label: "Strain",
    title: "Highest strain",
    unit: "",
    stat: "average daily strain (0-21 scale)",
    color: "var(--strain)",
    emoji: "🔥",
    board: "strain",
    decimals: 1,
  },
  sleep: {
    label: "Sleep",
    title: "Best sleep",
    unit: "%",
    stat: "average sleep score (0-100%)",
    color: "var(--sleep)",
    emoji: "😴",
    board: "sleep",
    decimals: 1,
  },
  steps: {
    label: "Steps",
    title: "Most steps",
    unit: "steps",
    stat: "total steps for the week",
    color: "#eef0f3",
    emoji: "👟",
    board: null,
    decimals: 0,
  },
  improved: {
    label: "Most improved",
    title: "Most improved",
    unit: "pts",
    stat: "gain in average recovery vs the week before, in percentage points",
    color: "var(--recovery-green)",
    emoji: "📈",
    board: "recovery",
    decimals: 1,
  },
};

export function isChampionCategory(v: unknown): v is ChampionCategory {
  return typeof v === "string" && (CHAMPION_CATEGORIES as readonly string[]).includes(v);
}

/** Someone on a category's list (winner or runner-up). Avatar fields are a snapshot at posting time. */
export type ChampionEntry = {
  userId: string;
  displayName: string;
  username: string | null;
  avatarKind: AvatarKind | null;
  avatarConfig: AvatarConfig | null;
  avatarPath: string | null;
  /** Rounded to the category's decimals (steps: integer). */
  value: number;
  unit: string;
  /** Days that went into the value (this week). */
  days: number;
  /** Improved only: last week's and this week's average recovery. */
  from?: number;
  to?: number;
};

export type ChampionCategoryResult = {
  category: ChampionCategory;
  /** One entry (deterministic tiebreak, see compute.ts); an array so a shared title can be added later. */
  winners: ChampionEntry[];
  /** Places 2 and 3. */
  runnersUp: ChampionEntry[];
};

/** Everything computed for one group and week (input to the text generator and the payload). */
export type ChampionFacts = {
  groupId: string;
  groupName: string;
  /** Group-local Monday (YYYY-MM-DD). */
  weekStart: string;
  /** "SEP 22 – 28". */
  weekLabel: string;
  /** Members that qualified for at least one category. */
  eligible: number;
  categories: ChampionCategoryResult[];
};

export type ChampionsSource = "gemini" | "template";

/** `messages.payload` of a `champions` post. */
export type ChampionsPayload = {
  v: 1;
  weekStart: string;
  weekLabel: string;
  categories: ChampionCategoryResult[];
  source: ChampionsSource;
  /** Added when read (never stored): winners / runners-up whose account no longer exists. */
  deletedUserIds?: string[];
};

/** "SEP 22 – 28", or "SEP 29 – OCT 5" across months. */
export function weekLabel(weekStart: string): string {
  const end = addDays(weekStart, 6);
  const [fm, fd] = shortDate(weekStart).split(" ");
  const [tm, td] = shortDate(end).split(" ");
  return fm === tm ? `${fm} ${fd} – ${td}` : `${fm} ${fd} – ${tm} ${td}`;
}

/** Title-case week label for prose: "Sep 22 – 28". */
export function weekLabelProse(weekStart: string): string {
  return weekLabel(weekStart).replace(/[A-Z]{3}/g, (m) => m[0] + m.slice(1).toLowerCase());
}

/** A value with its unit for prose: "91.2%", "15.4 strain", "84,210 steps", "+12.4 pts". */
export function formatChampionValue(category: ChampionCategory, value: number): string {
  const meta = CATEGORY_META[category];
  const n = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: meta.decimals,
    maximumFractionDigits: meta.decimals,
  }).format(value);
  switch (category) {
    case "recovery":
    case "sleep":
      return `${n}%`;
    case "strain":
      return `${n} strain`;
    case "steps":
      return `${n} steps`;
    case "improved":
      return `${value > 0 ? "+" : ""}${n} pts`;
  }
}

/* ------------------------------------------------------------------------ */
/* Reading a stored payload (defensive: it's JSON from the database)         */
/* ------------------------------------------------------------------------ */

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function parseEntry(raw: unknown): ChampionEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  const userId = str(e.userId);
  const value = num(e.value);
  if (!userId || value === null) return null;
  const kind = e.avatarKind === "upload" || e.avatarKind === "dicebear" ? e.avatarKind : null;
  return {
    userId,
    displayName: str(e.displayName)?.slice(0, 80) || "Member",
    username: str(e.username),
    avatarKind: kind,
    avatarConfig: e.avatarConfig && typeof e.avatarConfig === "object" ? (e.avatarConfig as AvatarConfig) : null,
    avatarPath: str(e.avatarPath),
    value,
    unit: str(e.unit) ?? "",
    days: num(e.days) ?? 0,
    ...(num(e.from) !== null ? { from: num(e.from)! } : {}),
    ...(num(e.to) !== null ? { to: num(e.to)! } : {}),
  };
}

const entries = (v: unknown, max: number): ChampionEntry[] =>
  Array.isArray(v) ? v.slice(0, max).map(parseEntry).filter((e): e is ChampionEntry => e !== null) : [];

/** A stored champions payload, validated; null when it isn't one (the card then shows the text only). */
export function parseChampionsPayload(raw: unknown): ChampionsPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const weekStart = str(p.weekStart);
  if (p.v !== 1 || !weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart) || !Array.isArray(p.categories)) return null;
  const categories: ChampionCategoryResult[] = [];
  for (const c of p.categories.slice(0, CHAMPION_CATEGORIES.length)) {
    if (!c || typeof c !== "object") continue;
    const r = c as Record<string, unknown>;
    if (!isChampionCategory(r.category) || categories.some((x) => x.category === r.category)) continue;
    const winners = entries(r.winners, 5);
    if (winners.length === 0) continue;
    categories.push({ category: r.category, winners, runnersUp: entries(r.runnersUp, 2) });
  }
  const deleted = Array.isArray(p.deletedUserIds) ? p.deletedUserIds.filter((x): x is string => typeof x === "string") : [];
  return {
    v: 1,
    weekStart,
    weekLabel: str(p.weekLabel) ?? weekLabel(weekStart),
    categories,
    source: p.source === "gemini" ? "gemini" : "template",
    ...(deleted.length ? { deletedUserIds: deleted } : {}),
  };
}

/** Every user id a payload mentions (winners and runners-up). */
export function payloadUserIds(payload: Record<string, unknown> | null): string[] {
  const ids = new Set<string>();
  const cats = payload && Array.isArray(payload.categories) ? payload.categories : [];
  for (const c of cats) {
    if (!c || typeof c !== "object") continue;
    for (const key of ["winners", "runnersUp"] as const) {
      const list = (c as Record<string, unknown>)[key];
      if (!Array.isArray(list)) continue;
      for (const e of list) {
        const id = e && typeof e === "object" ? (e as Record<string, unknown>).userId : null;
        if (typeof id === "string") ids.add(id);
      }
    }
  }
  return [...ids];
}
