import { describe, expect, it } from "vitest";
import { isReactionEmoji, REACTION_EMOJI } from "@/lib/chat/emoji";
import { linkify, safeHref } from "@/lib/chat/linkify";
import { codePointLength, MAX_MESSAGE_CHARS, normalizeBody } from "@/lib/chat/validate";

describe("linkify", () => {
  it("links http(s) URLs and leaves the rest as text", () => {
    expect(linkify("run https://strava.com/r/1 today")).toEqual([
      { type: "text", text: "run " },
      { type: "link", text: "https://strava.com/r/1", href: "https://strava.com/r/1" },
      { type: "text", text: " today" },
    ]);
    expect(linkify("see www.example.com")).toEqual([
      { type: "text", text: "see " },
      { type: "link", text: "www.example.com", href: "https://www.example.com/" },
    ]);
    expect(linkify("no links here")).toEqual([{ type: "text", text: "no links here" }]);
  });

  it("never links other schemes", () => {
    for (const s of [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox",
      "file:///etc/passwd",
      "mailto:a@b.c",
      "ftp://x.com",
      "//evil.com/x",
    ]) {
      expect(linkify(s).every((seg) => seg.type === "text"), s).toBe(true);
    }
    // A javascript: URL glued to an http one only links the http part.
    const segs = linkify("javascript:https://x.com");
    expect(segs.filter((s) => s.type === "link").map((s) => (s as { href: string }).href)).toEqual(["https://x.com/"]);
  });

  it("keeps markup-ish text as text and never puts quotes or brackets into an href", () => {
    const segs = linkify(`<img src=x onerror=alert(1)> https://a.com/"onmouseover="x <b>`);
    const link = segs.find((s) => s.type === "link") as { href: string; text: string };
    expect(link.text).toBe("https://a.com/");
    expect(segs.map((s) => s.text).join("")).toBe(`<img src=x onerror=alert(1)> https://a.com/"onmouseover="x <b>`);
    for (const s of segs) if (s.type === "link") expect(s.href).not.toMatch(/["<>'\s]/);
  });

  it("trims trailing punctuation and unbalanced brackets", () => {
    const link = (t: string) => (linkify(t).find((s) => s.type === "link") as { text: string } | undefined)?.text;
    expect(link("go to https://x.com/a.")).toBe("https://x.com/a");
    expect(link("(see https://x.com/a)")).toBe("https://x.com/a");
    expect(link("wiki https://en.wikipedia.org/wiki/Foo_(bar)!")).toBe("https://en.wikipedia.org/wiki/Foo_(bar)");
    expect(link("really? https://x.com?!")).toBe("https://x.com");
  });

  it("rejects credentials in URLs (spoofing) and malformed hosts", () => {
    expect(safeHref("https://google.com@evil.com")).toBeNull();
    expect(safeHref("https://user:pw@x.com")).toBeNull();
    expect(safeHref("https://")).toBeNull();
    expect(safeHref("http://x.com/ok")).toBe("http://x.com/ok");
  });

  it("round-trips the text exactly", () => {
    const t = "a https://x.com/b, www.y.org\nnext line http://z.io.";
    expect(linkify(t).map((s) => s.text).join("")).toBe(t);
  });
});

describe("normalizeBody", () => {
  it("trims and accepts 1-1000 code points", () => {
    expect(normalizeBody("  hi  ")).toEqual({ ok: true, body: "hi" });
    expect(normalizeBody("   \n\t ")).toMatchObject({ ok: false, code: "empty" });
    expect(normalizeBody(42)).toMatchObject({ ok: false, code: "empty" });
    expect(normalizeBody("x".repeat(MAX_MESSAGE_CHARS))).toMatchObject({ ok: true });
    expect(normalizeBody("x".repeat(MAX_MESSAGE_CHARS + 1))).toMatchObject({ ok: false, code: "too_long" });
    // Emoji count as one character each (surrogate pairs).
    expect(codePointLength("🔥💪")).toBe(2);
    expect(normalizeBody("🔥".repeat(MAX_MESSAGE_CHARS))).toMatchObject({ ok: true });
  });

  it("normalizes line endings and collapses more than 3 blank lines", () => {
    expect(normalizeBody("a\r\nb")).toEqual({ ok: true, body: "a\nb" });
    expect(normalizeBody("a\n\n\n\nb")).toEqual({ ok: true, body: "a\n\n\n\nb" }); // 3 blank lines: kept
    expect(normalizeBody("a\n\n\n\n\n\n\nb")).toEqual({ ok: true, body: "a\n\n\n\nb" });
    expect(normalizeBody("a\n \n\t\n\n\n\nb")).toEqual({ ok: true, body: "a\n\n\n\nb" });
    expect(normalizeBody("keep\ttabs\nand lines")).toEqual({ ok: true, body: "keep\ttabs\nand lines" });
  });

  it("rejects control and bidi override characters", () => {
    for (const s of ["a\u0000b", "bell\u0007", "esc\u001b[31m", "del\u007f", "c1\u0085", "rlo‮evil", "iso⁦x"]) {
      expect(normalizeBody(s), JSON.stringify(s)).toMatchObject({ ok: false, code: "invalid_chars" });
    }
  });
});

describe("reaction emoji", () => {
  it("is a curated set of about a dozen", () => {
    expect(REACTION_EMOJI.length).toBeGreaterThanOrEqual(10);
    expect(new Set(REACTION_EMOJI).size).toBe(REACTION_EMOJI.length);
    // Fits the reactions.emoji CHECK (1-16 chars).
    for (const e of REACTION_EMOJI) expect(e.length).toBeLessThanOrEqual(16);
    expect(isReactionEmoji("🔥")).toBe(true);
    expect(isReactionEmoji("🍕")).toBe(false);
    expect(isReactionEmoji("<script>")).toBe(false);
    expect(isReactionEmoji(undefined)).toBe(false);
  });
});
