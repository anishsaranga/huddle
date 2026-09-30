/**
 * The champions post's text: Gemini when configured, else (or on any
 * failure) the deterministic template. The model only ever sees the computed
 * facts (display names, categories, values, units, the week label): no
 * emails, user ids or avatars.
 */

import type { Logger } from "pino";
import { geminiGenerate, type GeminiFailure } from "@/lib/ai/gemini";
import { getEnv } from "@/lib/env";
import { childLogger } from "@/lib/log";
import { championsTemplate } from "./template";
import { CATEGORY_META, formatChampionValue, weekLabelProse, type ChampionFacts, type ChampionsSource } from "./types";

export type ChampionsText = {
  text: string;
  source: ChampionsSource;
  /** Why the template was used (when it was). */
  fallbackReason?: GeminiFailure;
};

export type ChampionsGenerator = (facts: ChampionFacts) => Promise<ChampionsText>;

export const CHAMPIONS_SYSTEM_PROMPT = [
  "You write the weekly champions post for a private group chat of friends who track their fitness together.",
  "Tone: witty, warm and hype, like a friend in the group chat. Emoji are welcome.",
  "Rules:",
  "- Mention every winner by their display name exactly as given, with their stat and unit.",
  "- At most 5 short lines. Plain text only: no markdown, no headings, no hashtags, no bullet symbols other than emoji.",
  "- Celebrate; never shame or tease anyone about low numbers, and don't mention anyone who isn't in the facts.",
  "- No medical or health claims or advice.",
  "- Use only the facts provided. Don't invent numbers, names or events.",
].join("\n");

/** The facts as the model sees them (JSON-serializable, names and numbers only). */
export function promptFacts(facts: ChampionFacts) {
  return {
    week: weekLabelProse(facts.weekStart),
    group: facts.groupName,
    categories: facts.categories.map((c) => {
      const w = c.winners[0];
      return {
        category: CATEGORY_META[c.category].title,
        what: CATEGORY_META[c.category].stat,
        winner: w.displayName,
        value: w.value,
        unit: c.category === "strain" ? "strain" : w.unit,
        display: formatChampionValue(c.category, w.value),
        ...(c.category === "improved" && w.from !== undefined && w.to !== undefined
          ? { lastWeekAverage: w.from, thisWeekAverage: w.to }
          : {}),
        runnersUp: c.runnersUp.map((r) => ({ name: r.displayName, display: formatChampionValue(c.category, r.value) })),
      };
    }),
  };
}

export function buildChampionsPrompt(facts: ChampionFacts): { system: string; prompt: string } {
  return {
    system: CHAMPIONS_SYSTEM_PROMPT,
    prompt: `Write this week's champions post from these facts (JSON):\n${JSON.stringify(promptFacts(facts), null, 2)}`,
  };
}

/** Always the template (tests, previews). */
export const templateGenerator: ChampionsGenerator = async (facts) => ({ text: championsTemplate(facts), source: "template" });

export type GeneratorOptions = {
  apiKey?: string;
  model?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  retryDelayMs?: number;
  log?: Logger;
};

/**
 * Gemini with the template as the fallback. Key and model default to
 * GEMINI_API_KEY / GEMINI_MODEL, read when called (so the worker picks up .env).
 */
export function createChampionsGenerator(opts: GeneratorOptions = {}): ChampionsGenerator {
  return async (facts) => {
    const log = opts.log ?? childLogger("ai");
    const env = getEnv();
    const { system, prompt } = buildChampionsPrompt(facts);
    const r = await geminiGenerate(
      { system, prompt, temperature: 0.9 },
      {
        apiKey: "apiKey" in opts ? opts.apiKey : env.GEMINI_API_KEY,
        model: "model" in opts ? opts.model : env.GEMINI_MODEL,
        fetch: opts.fetch,
        timeoutMs: opts.timeoutMs,
        retryDelayMs: opts.retryDelayMs,
        log,
      },
    );
    if (r.ok) return { text: r.text, source: "gemini" };
    log.info({ groupId: facts.groupId, weekStart: facts.weekStart, fallbackReason: r.reason }, "champions text: using the template");
    return { text: championsTemplate(facts), source: "template", fallbackReason: r.reason };
  };
}
