import { memo } from "react";
import { linkify } from "@/lib/chat/linkify";

/**
 * Message body as React text nodes (never HTML), http(s) links as anchors.
 * Newlines are kept by the bubble's `white-space: pre-wrap`.
 */
export const MessageText = memo(function MessageText({ text }: { text: string }) {
  return (
    <>
      {linkify(text).map((seg, i) =>
        seg.type === "link" ? (
          <a
            key={i}
            href={seg.href}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-text underline decoration-white/35 underline-offset-[3px] transition-colors hover:decoration-white/80"
            onClick={(e) => e.stopPropagation()}
          >
            {seg.text}
          </a>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  );
});

const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|\p{Emoji_Modifier}|‍|️|\s)+$/u;

/** 1-3 emoji and nothing else: rendered large, without a bubble. */
export function isJumboEmoji(text: string): boolean {
  if (!text || text.length > 40 || !EMOJI_ONLY.test(text) || /^[\d#*\s]+$/.test(text)) return false;
  const stripped = text.replace(/\s/g, "");
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const n = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(stripped)].length;
    return n >= 1 && n <= 3;
  }
  return [...stripped].length <= 3;
}
