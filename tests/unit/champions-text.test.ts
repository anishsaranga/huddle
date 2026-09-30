import { describe, expect, it, vi } from "vitest";
import { cleanModelText, extractGeminiText, GEMINI_ENDPOINT, geminiGenerate } from "@/lib/ai/gemini";
import { buildChampionsPrompt, createChampionsGenerator } from "@/lib/champions/generate";
import { championsTemplate, TEMPLATE_PHRASINGS, templateVariant } from "@/lib/champions/template";
import type { ChampionEntry, ChampionFacts } from "@/lib/champions/types";
import { createLogger } from "@/lib/log";

const KEY = "AIzaSy-test-secret-key-123";

function entry(userId: string, displayName: string, value: number, unit: string, extra: Partial<ChampionEntry> = {}): ChampionEntry {
  return { userId, displayName, username: null, avatarKind: null, avatarConfig: null, avatarPath: null, value, unit, days: 6, ...extra };
}

const FACTS: ChampionFacts = {
  groupId: "7d1c9a52-0b43-4c1e-9b0a-2f7d3b6f0c11",
  groupName: "Morning Crew",
  weekStart: "2026-09-21",
  weekLabel: "SEP 21 – 27",
  eligible: 4,
  categories: [
    { category: "recovery", winners: [entry("u1", "Maya Patel", 81.4, "%")], runnersUp: [entry("u2", "Arjun", 77, "%")] },
    { category: "strain", winners: [entry("u2", "Arjun", 15.2, "")], runnersUp: [] },
    { category: "sleep", winners: [entry("u3", "Leo", 91, "%")], runnersUp: [] },
    { category: "steps", winners: [entry("u4", "Priya", 84210, "steps")], runnersUp: [] },
    { category: "improved", winners: [entry("u3", "Leo", 12.4, "pts", { from: 60, to: 72.4 })], runnersUp: [] },
  ],
};

/** A logger that records every line (to check nothing secret is logged). */
function capture() {
  const lines: string[] = [];
  const log = createLogger({ write: (s: string) => void lines.push(s) }, { level: "debug" });
  return { log, lines };
}

const reply = (text: string, status = 200) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }] }), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("template", () => {
  it("one line per winner with values and units, framed by an intro and an outro", () => {
    const text = championsTemplate(FACTS, 0);
    const lines = text.split("\n");
    expect(lines).toHaveLength(7);
    expect(lines[0]).toBe("🏆 Champions for Sep 21 – 27 are in!");
    expect(text).toContain("Maya Patel bounced back best: 81.4% recovery");
    expect(text).toContain("Arjun pushed hardest: 15.2 strain");
    expect(text).toContain("Leo owned the night: 91.0% sleep");
    expect(text).toContain("84,210 steps");
    expect(text).toContain("+12.4 pts recovery vs last week");
  });

  it("rotates phrasings week to week, deterministically", () => {
    const all = TEMPLATE_PHRASINGS.map((_, i) => championsTemplate(FACTS, i));
    expect(new Set(all).size).toBe(TEMPLATE_PHRASINGS.length);
    const v1 = templateVariant(FACTS.groupId, "2026-09-21");
    const v2 = templateVariant(FACTS.groupId, "2026-09-28");
    expect(v2).toBe((v1 + 1) % TEMPLATE_PHRASINGS.length);
    expect(championsTemplate(FACTS)).toBe(championsTemplate(FACTS));
  });

  it("only mentions categories that have a winner", () => {
    const text = championsTemplate({ ...FACTS, categories: FACTS.categories.slice(2, 3) }, 1);
    expect(text.split("\n")).toHaveLength(3);
    expect(text).toContain("Sleep royalty: Leo (91.0%)");
  });
});

describe("Gemini response parsing", () => {
  it("joins candidates[0].content.parts[].text, skipping thoughts", () => {
    expect(
      extractGeminiText({ candidates: [{ content: { parts: [{ text: "thinking…", thought: true }, { text: "Hello " }, { text: "crew" }] } }] }),
    ).toBe("Hello crew");
    expect(extractGeminiText({ candidates: [] })).toBeNull();
    expect(extractGeminiText({ candidates: [{ finishReason: "SAFETY" }] })).toBeNull();
    expect(extractGeminiText("nope")).toBeNull();
  });

  it("strips markdown fences, control and bidi characters, and collapses blank lines", () => {
    expect(cleanModelText("```text\n🏆 Hello crew!\nGo team\n```")).toBe("🏆 Hello crew!\nGo team");
    expect(cleanModelText("```\nHi\n```\n")).toBe("Hi");
    expect(cleanModelText("Hi\n```\nthere")).toBe("Hi\n\nthere");
    expect(cleanModelText("a\u0007b‮c\n\n\n\n\nd")).toBe("abc\n\nd");
  });

  it("caps the text at 600 characters on a word boundary", () => {
    const long = Array.from({ length: 200 }, (_, i) => `word${i}`).join(" ");
    const out = cleanModelText(long);
    expect(Array.from(out).length).toBeLessThanOrEqual(600);
    expect(out.endsWith("…")).toBe(true);
    const kept = out.slice(0, -1);
    expect(long.startsWith(kept)).toBe(true);
    expect(long[kept.length]).toBe(" "); // cut on a whole word
    expect(cleanModelText("x".repeat(700))).toHaveLength(600);
    expect(cleanModelText("😀".repeat(700)).length).toBe(599 * 2 + 1); // code points, not UTF-16 units
  });
});

describe("geminiGenerate", () => {
  it("sends the key only in the x-goog-api-key header (never in the URL or logs) and parses the reply", async () => {
    const { log, lines } = capture();
    const fetchMock = vi.fn<(url: string | URL | Request, init?: RequestInit) => Promise<Response>>(async () => reply("```\n🏆 Go crew!\n```"));
    const r = await geminiGenerate({ system: "sys", prompt: "SECRET-PROMPT-TEXT" }, { apiKey: KEY, model: "gemini-2.5-flash", fetch: fetchMock as typeof fetch, log });
    expect(r).toMatchObject({ ok: true, text: "🏆 Go crew!", attempts: 1 });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`${GEMINI_ENDPOINT}/gemini-2.5-flash:generateContent`);
    expect(String(url)).not.toContain(KEY);
    expect(String(url)).not.toContain("key=");
    expect((init!.headers as Record<string, string>)["x-goog-api-key"]).toBe(KEY);
    const body = JSON.parse(String(init!.body));
    expect(body.systemInstruction.parts[0].text).toBe("sys");
    expect(body.contents[0].parts[0].text).toBe("SECRET-PROMPT-TEXT");
    expect(body.generationConfig.temperature).toBe(0.9);
    expect(body.generationConfig.maxOutputTokens).toBeLessThanOrEqual(1024);

    const logged = lines.join("\n");
    expect(logged).toContain('"provider":"gemini"');
    expect(logged).toContain("latencyMs");
    expect(logged).not.toContain(KEY);
    expect(logged).not.toContain("SECRET-PROMPT-TEXT");
  });

  it("retries once on 429 / 5xx, then gives up", async () => {
    const { log } = capture();
    const flaky = vi.fn().mockResolvedValueOnce(new Response("busy", { status: 429 })).mockResolvedValueOnce(reply("ok!"));
    expect(await geminiGenerate({ system: "s", prompt: "p" }, { apiKey: KEY, model: "m", fetch: flaky, retryDelayMs: 1, log })).toMatchObject({
      ok: true,
      text: "ok!",
      attempts: 2,
    });

    const down = vi.fn(async () => new Response("err", { status: 503 }));
    expect(await geminiGenerate({ system: "s", prompt: "p" }, { apiKey: KEY, model: "m", fetch: down, retryDelayMs: 1, log })).toMatchObject({
      ok: false,
      reason: "server_error",
      status: 503,
      attempts: 2,
    });
    expect(down).toHaveBeenCalledTimes(2);

    const bad = vi.fn(async () => new Response("no", { status: 400 }));
    expect(await geminiGenerate({ system: "s", prompt: "p" }, { apiKey: KEY, model: "m", fetch: bad, retryDelayMs: 1, log })).toMatchObject({
      ok: false,
      reason: "http_error",
      attempts: 1,
    });
  });

  it("times out (AbortController) without retrying", async () => {
    const { log } = capture();
    const hang = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_, reject) => init!.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))),
    );
    const r = await geminiGenerate({ system: "s", prompt: "p" }, { apiKey: KEY, model: "m", fetch: hang as typeof fetch, timeoutMs: 20, log });
    expect(r).toMatchObject({ ok: false, reason: "timeout", attempts: 1 });
    expect(hang).toHaveBeenCalledTimes(1);
  });

  it("not configured / bad model names never call fetch; empty replies fail", async () => {
    const { log } = capture();
    const f = vi.fn(async () => reply("x"));
    expect(await geminiGenerate({ system: "s", prompt: "p" }, { apiKey: "", model: "m", fetch: f, log })).toMatchObject({ ok: false, reason: "not_configured" });
    expect(await geminiGenerate({ system: "s", prompt: "p" }, { apiKey: KEY, model: undefined, fetch: f, log })).toMatchObject({ ok: false, reason: "not_configured" });
    expect(await geminiGenerate({ system: "s", prompt: "p" }, { apiKey: KEY, model: "../evil?x=1", fetch: f, log })).toMatchObject({ ok: false, reason: "invalid_model" });
    expect(f).not.toHaveBeenCalled();
    const blank = vi.fn(async () => new Response(JSON.stringify({ candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [] } }] })));
    expect(await geminiGenerate({ system: "s", prompt: "p" }, { apiKey: KEY, model: "m", fetch: blank, log })).toMatchObject({ ok: false, reason: "empty" });
    const junk = vi.fn(async () => new Response("<html>", { status: 200 }));
    expect(await geminiGenerate({ system: "s", prompt: "p" }, { apiKey: KEY, model: "m", fetch: junk, log })).toMatchObject({ ok: false, reason: "bad_response" });
  });
});

describe("champions generator", () => {
  it("prompt carries only the computed facts: names, categories, values, units, week (no ids)", () => {
    const { system, prompt } = buildChampionsPrompt(FACTS);
    expect(system).toMatch(/no medical/i);
    expect(system).toMatch(/at most 5 short lines/i);
    for (const e of FACTS.categories.flatMap((c) => [...c.winners, ...c.runnersUp])) expect(prompt).not.toContain(`"${e.userId}"`);
    expect(prompt).not.toContain(FACTS.groupId);
    expect(prompt).not.toContain("@");
    expect(prompt).toContain("Maya Patel");
    expect(prompt).toContain("84,210 steps");
    expect(prompt).toContain("Sep 21 – 27");
  });

  it("uses Gemini's text when it works", async () => {
    const { log } = capture();
    const gen = createChampionsGenerator({ apiKey: KEY, model: "gemini-2.5-flash", fetch: vi.fn(async () => reply("🏆 Maya wins!")), log });
    expect(await gen(FACTS)).toEqual({ text: "🏆 Maya wins!", source: "gemini" });
  });

  it("falls back to the template when unconfigured, on errors and on timeouts", async () => {
    const { log } = capture();
    const tmpl = championsTemplate(FACTS);
    expect(await createChampionsGenerator({ apiKey: undefined, model: undefined, log })(FACTS)).toEqual({
      text: tmpl,
      source: "template",
      fallbackReason: "not_configured",
    });
    const down = createChampionsGenerator({ apiKey: KEY, model: "m", fetch: vi.fn(async () => new Response("", { status: 500 })), retryDelayMs: 1, log });
    expect(await down(FACTS)).toMatchObject({ source: "template", fallbackReason: "server_error", text: tmpl });
    const netErr = createChampionsGenerator({ apiKey: KEY, model: "m", fetch: vi.fn(async () => Promise.reject(new TypeError("fetch failed"))), retryDelayMs: 1, log });
    expect(await netErr(FACTS)).toMatchObject({ source: "template", fallbackReason: "network" });
    const slow = createChampionsGenerator({
      apiKey: KEY,
      model: "m",
      timeoutMs: 10,
      fetch: ((_u: unknown, init?: RequestInit) =>
        new Promise((_, reject) => init!.signal!.addEventListener("abort", () => reject(new Error("aborted"))))) as typeof fetch,
      log,
    });
    expect(await slow(FACTS)).toMatchObject({ source: "template", fallbackReason: "timeout" });
  });
});
