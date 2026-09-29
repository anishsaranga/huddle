/**
 * Copy text to the clipboard. Uses the async Clipboard API when available,
 * falling back to a hidden textarea + execCommand("copy") (older iOS Safari,
 * non-secure contexts). Must be called from a user gesture.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  return legacyCopy(text);
}

function legacyCopy(text: string): boolean {
  if (typeof document === "undefined") return false;
  const ta = document.createElement("textarea");
  ta.value = text;
  // Keep it off-screen but selectable; 16px avoids iOS zoom, readonly avoids the keyboard.
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.top = "0";
  ta.style.left = "-9999px";
  ta.style.fontSize = "16px";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  const previous = document.activeElement as HTMLElement | null;
  try {
    // iOS needs an explicit range selection on a contentEditable element.
    ta.contentEditable = "true";
    const range = document.createRange();
    range.selectNodeContents(ta);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    ta.select();
    ta.setSelectionRange(0, text.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(ta);
    window.getSelection()?.removeAllRanges();
    previous?.focus?.();
  }
}
