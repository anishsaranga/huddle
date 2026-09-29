import type { AvatarUser } from "@/components/ui/Avatar";
import type { BoardMember } from "@/lib/scores/queries";
import type { BoardPeriod } from "@/lib/scores/period";
import type { ScoreMetric } from "@/lib/scores/queries";
import { recoveryColor, SIGNAL, STRAIN_MAX } from "@/lib/ui/colors";
import { formatNumber } from "@/lib/ui/format";

/** How each score looks on the Community tab (colors carry meaning, as everywhere). */
export const METRIC = {
  strain: { label: "Strain", noun: "strain", color: SIGNAL.strain, max: STRAIN_MAX, unit: "" },
  recovery: { label: "Recovery", noun: "recovery", color: SIGNAL.green, max: 100, unit: "%" },
  sleep: { label: "Sleep", noun: "sleep", color: SIGNAL.sleep, max: 100, unit: "%" },
} as const satisfies Record<ScoreMetric, { label: string; noun: string; color: string; max: number; unit: string }>;

/** Signal color of a value: recovery by band, the others by metric. */
export function metricColor(metric: ScoreMetric, value: number | null | undefined): string {
  if (metric === "recovery") return typeof value === "number" ? recoveryColor(value) : "var(--muted)";
  return METRIC[metric].color;
}

/** Strain always has one decimal; weekly means keep theirs (ranking compares at that precision). */
export function metricDecimals(metric: ScoreMetric, period: BoardPeriod = "day"): number {
  return metric === "strain" || period === "week" ? 1 : 0;
}

export function formatMetric(metric: ScoreMetric, value: number, period: BoardPeriod = "day"): string {
  return `${formatNumber(value, metricDecimals(metric, period))}${METRIC[metric].unit}`;
}

/** First name for tight spots (podium), falling back to the username. */
export function firstName(m: { displayName: string | null; username: string | null }): string {
  return m.displayName?.trim().split(/\s+/)[0] || m.username || "Member";
}

export function fullName(m: { displayName: string | null; username: string | null }): string {
  return m.displayName?.trim() || m.username || "Member";
}

/** A board / group member as an <Avatar> user. */
export function avatarUserOf(m: BoardMember): AvatarUser {
  return {
    id: m.userId,
    displayName: m.displayName,
    username: m.username,
    avatarKind: m.avatarKind,
    avatarConfig: m.avatarConfig,
    avatarPath: m.avatarPath,
  };
}
