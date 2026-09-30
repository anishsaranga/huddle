/**
 * Deterministic champions text: used when Gemini isn't configured or fails.
 * A few phrasings rotate by week (and group), so consecutive weeks read
 * differently; the same week always produces the same text.
 */

import { formatChampionValue, weekLabelProse, type ChampionCategory, type ChampionFacts } from "./types";

type Phrasing = {
  intro: (week: string) => string;
  line: Record<ChampionCategory, (name: string, stat: string) => string>;
  outro: string;
};

export const TEMPLATE_PHRASINGS: readonly Phrasing[] = [
  {
    intro: (w) => `🏆 Champions for ${w} are in!`,
    line: {
      recovery: (n, s) => `💚 ${n} bounced back best: ${s} recovery`,
      strain: (n, s) => `🔥 ${n} pushed hardest: ${s}`,
      sleep: (n, s) => `😴 ${n} owned the night: ${s} sleep`,
      steps: (n, s) => `👟 ${n} racked up ${s}`,
      improved: (n, s) => `📈 ${n} leveled up: ${s} recovery vs last week`,
    },
    outro: "Same time next week? 💪",
  },
  {
    intro: (w) => `🥇 Week of ${w}: the results!`,
    line: {
      recovery: (n, s) => `💚 Recovery crown: ${n} (${s})`,
      strain: (n, s) => `🔥 Strain machine: ${n} (${s})`,
      sleep: (n, s) => `😴 Sleep royalty: ${n} (${s})`,
      steps: (n, s) => `👟 Step boss: ${n} (${s})`,
      improved: (n, s) => `📈 Glow-up of the week: ${n} (${s} recovery)`,
    },
    outro: "New week, clean slate. Go get it! ⚡",
  },
  {
    intro: (w) => `📣 ${w} wrap-up, crew!`,
    line: {
      recovery: (n, s) => `💚 ${n} recharged like a pro at ${s}`,
      strain: (n, s) => `🔥 ${n} brought the heat with ${s}`,
      sleep: (n, s) => `😴 ${n} slept like a champ at ${s}`,
      steps: (n, s) => `👟 ${n} covered serious ground: ${s}`,
      improved: (n, s) => `📈 ${n} made the biggest jump: ${s} recovery`,
    },
    outro: "Who's taking a title next week? 👀",
  },
  {
    intro: (w) => `✨ And the ${w} champions are…`,
    line: {
      recovery: (n, s) => `💚 ${n}, best recovery (${s})`,
      strain: (n, s) => `🔥 ${n}, hardest worker (${s})`,
      sleep: (n, s) => `😴 ${n}, best sleep (${s})`,
      steps: (n, s) => `👟 ${n}, most steps (${s})`,
      improved: (n, s) => `📈 ${n}, most improved (${s} recovery)`,
    },
    outro: "Proud of this group. Keep it rolling! 🙌",
  },
];

/** Small stable hash (FNV-1a) of a string. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Which phrasing a group's week uses (rotates week to week). */
export function templateVariant(groupId: string, weekStart: string): number {
  const weekIndex = Math.floor(Date.parse(`${weekStart}T00:00:00Z`) / (7 * 86_400_000));
  return (weekIndex + (hash(groupId) % TEMPLATE_PHRASINGS.length)) % TEMPLATE_PHRASINGS.length;
}

/** The fallback post: an intro, one line per category winner, an outro. */
export function championsTemplate(facts: ChampionFacts, variant = templateVariant(facts.groupId, facts.weekStart)): string {
  const p = TEMPLATE_PHRASINGS[((variant % TEMPLATE_PHRASINGS.length) + TEMPLATE_PHRASINGS.length) % TEMPLATE_PHRASINGS.length];
  const lines = [p.intro(weekLabelProse(facts.weekStart))];
  for (const c of facts.categories) {
    const w = c.winners[0];
    if (!w) continue;
    lines.push(p.line[c.category](w.displayName, formatChampionValue(c.category, w.value)));
  }
  lines.push(p.outro);
  return lines.join("\n");
}
