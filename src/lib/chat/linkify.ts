/**
 * Split message text into plain-text and link segments (pure). The UI renders
 * every segment as a text node, links as <a> with the parsed `href` only, so
 * nothing in a message can become markup.
 *
 * Only http(s) links are produced: explicit `http://` / `https://` URLs and
 * bare `www.` hosts (as https). Anything else (javascript:, data:, mailto:,
 * file:, …) stays plain text. Trailing punctuation and unbalanced closing
 * brackets are left outside the link ("see https://x.com/a)." links
 * "https://x.com/a").
 */

export type TextSegment = { type: "text"; text: string } | { type: "link"; text: string; href: string };

// Candidates start at a word boundary with a scheme or "www."; they run to whitespace or a
// character that can't be part of a URL in running text.
const CANDIDATE = /\b(?:https?:\/\/|www\.)[^\s<>"'`]+/gi;
const TRAILING = /[.,;:!?'"*_~]+$/;
const MAX_URL = 2048;

const PAIRS: Record<string, string> = { ")": "(", "]": "[", "}": "{" };

/** Trim trailing punctuation and closing brackets that have no opener inside the URL. */
function trimCandidate(url: string): string {
  let s = url;
  for (;;) {
    const before = s;
    s = s.replace(TRAILING, "");
    const last = s.at(-1);
    if (last && PAIRS[last]) {
      const open = PAIRS[last];
      const opens = s.split(open).length - 1;
      const closes = s.split(last).length - 1;
      if (closes > opens) s = s.slice(0, -1);
    }
    if (s === before) return s;
  }
}

/** A safe absolute http(s) URL for `text`, or null. */
export function safeHref(text: string): string | null {
  const withScheme = /^www\./i.test(text) ? `https://${text}` : text;
  if (!/^https?:\/\//i.test(withScheme) || withScheme.length > MAX_URL) return null;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!url.hostname || url.username || url.password) return null;
  return url.href;
}

export function linkify(text: string): TextSegment[] {
  const out: TextSegment[] = [];
  let last = 0;
  const pushText = (t: string) => {
    if (!t) return;
    const prev = out.at(-1);
    if (prev?.type === "text") prev.text += t;
    else out.push({ type: "text", text: t });
  };
  for (const m of text.matchAll(CANDIDATE)) {
    const start = m.index ?? 0;
    const candidate = trimCandidate(m[0]);
    const href = candidate.length > 4 ? safeHref(candidate) : null;
    if (!href) continue;
    pushText(text.slice(last, start));
    out.push({ type: "link", text: candidate, href });
    last = start + candidate.length;
  }
  pushText(text.slice(last));
  return out;
}
