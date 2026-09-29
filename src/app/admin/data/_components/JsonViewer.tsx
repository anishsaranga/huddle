"use client";

import { useState } from "react";
import { copyText } from "@/components/apikey/clipboard";
import { SIGNAL } from "@/lib/ui/colors";
import { formatBytes } from "@/lib/ui/format";

type JsonViewerProps = {
  /** Text to show (already pretty-printed / truncated by the server). */
  text: string;
  /** The stored body is longer than `text`. */
  truncated: boolean;
  /** Stored size of the whole body. */
  totalBytes: number;
};

/** Monospace, scrollable body viewer with a copy button and a truncation notice. */
export function JsonViewer({ text, truncated, totalBytes }: JsonViewerProps) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    const ok = await copyText(text);
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  if (text === "") {
    return <p className="telemetry py-2">No body was stored for this request.</p>;
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 pb-2">
        <p className="telemetry num">{formatBytes(totalBytes)} as JSON</p>
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? "Copied" : truncated ? "Copy shown part of the body" : "Copy body"}
          className="telemetry inline-flex h-8 items-center rounded-full bg-white/[0.04] px-3 text-text-2 shadow-[inset_0_0_0_1px_var(--hairline-strong)] transition-opacity active:opacity-60"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre
        tabIndex={0}
        aria-label="Raw request body"
        data-testid="raw-body"
        className="max-h-72 overflow-auto overscroll-contain rounded-xl bg-card-sunken p-3 font-mono text-[11.5px] leading-[1.55] text-text-2 shadow-[inset_0_1px_2px_rgb(0_0_0/0.5),inset_0_0_0_1px_var(--hairline)] [scrollbar-color:var(--hairline-strong)_transparent] [scrollbar-width:thin]"
      >
        {text}
      </pre>
      {truncated && (
        <p className="telemetry mt-2" style={{ color: SIGNAL.yellow }}>
          Showing the first {formatBytes(text.length)} of {formatBytes(totalBytes)}. The rest is stored but not displayed.
        </p>
      )}
    </div>
  );
}
