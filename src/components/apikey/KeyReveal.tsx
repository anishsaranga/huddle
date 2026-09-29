"use client";

import { AnimatePresence, motion } from "motion/react";
import { Fragment, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { alpha, SIGNAL } from "@/lib/ui/colors";
import { PRESS_SCALE, spring } from "@/lib/ui/motion";
import { copyText } from "./clipboard";

const COPIED_MS = 2200;

const CopyIcon = ({ size = 18 }: { size?: number }) => (
  <svg aria-hidden width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <rect x="6.5" y="6.5" width="10" height="10" rx="2.2" />
    <path d="M13.5 3.5h-8a2 2 0 0 0-2 2v8" />
  </svg>
);

const CheckIcon = ({ size = 18 }: { size?: number }) => (
  <svg aria-hidden width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
    <motion.path
      d="m4.5 10.5 3.6 3.6 7.4-8"
      initial={{ pathLength: 0 }}
      animate={{ pathLength: 1 }}
      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
    />
  </svg>
);

const WarnIcon = () => (
  <svg aria-hidden width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className="mt-px shrink-0">
    <path d="M10 3.2 17.6 16.3H2.4z" />
    <path d="M10 8.2v3.6" />
    <path d="M10 14.4h.01" />
  </svg>
);

/** Copy with success/failure toasts and a transient "copied" flag for the check animation. */
export function useCopy(what: string) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async (text: string, successDescription?: string) => {
    const ok = await copyText(text);
    if (ok) {
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), COPIED_MS);
      toast({ title: `${what} copied`, description: successDescription, tone: "success" });
    } else {
      toast({ title: `Couldn't copy the ${what.toLowerCase()}`, description: "Press and hold it to copy instead.", tone: "error" });
    }
  };
  return { copied, copy };
}

/** Icon swap between copy and an animated check. */
export function CopyGlyph({ copied, size }: { copied: boolean; size?: number }) {
  return (
    <span className="relative grid place-items-center" style={{ width: size ?? 18, height: size ?? 18 }}>
      <AnimatePresence initial={false} mode="popLayout">
        {copied ? (
          <motion.span
            key="check"
            className="absolute inset-0 grid place-items-center"
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.4, opacity: 0 }}
            transition={spring.bouncy}
          >
            <CheckIcon size={size} />
          </motion.span>
        ) : (
          <motion.span
            key="copy"
            className="absolute inset-0 grid place-items-center"
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.6, opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <CopyIcon size={size} />
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

/** A labelled, sunken value (wraps, never truncated) with a trailing copy button (e.g. the ingest URL). */
export function CopyField({ label, value, testId }: { label: string; value: string; testId?: string }) {
  const { copied, copy } = useCopy(label);
  return (
    <div>
      <p className="label mb-2">{label}</p>
      <div className="flex min-h-12 items-center gap-2 rounded-xl bg-card-sunken py-1.5 pl-4 pr-1.5 shadow-[inset_0_1px_2px_rgb(0_0_0/0.5),inset_0_0_0_1px_var(--hairline-strong)]">
        <span data-testid={testId} className="min-w-0 flex-1 select-all font-mono text-[12px] leading-snug text-text-2 [overflow-wrap:anywhere]">
          {/* Prefer line breaks after "/" so long URLs wrap at path boundaries. */}
          {value.split(/(?<=\/)/).map((part, i) => (
            <Fragment key={i}>
              {i > 0 && <wbr />}
              {part}
            </Fragment>
          ))}
        </span>
        <motion.button
          type="button"
          onClick={() => copy(value)}
          aria-label={`Copy ${label.toLowerCase()}`}
          whileTap={{ scale: PRESS_SCALE }}
          transition={spring.press}
          className="grid size-9 shrink-0 place-items-center rounded-lg text-text-2 transition-colors active:bg-white/[0.06]"
          style={copied ? { color: SIGNAL.green } : undefined}
        >
          <CopyGlyph copied={copied} size={17} />
        </motion.button>
      </div>
    </div>
  );
}

type KeyRevealProps = {
  /** The plaintext key. Shown once: it can't be fetched again after this. */
  apiKey: string;
  /** `${APP_URL}/api/ingest`. */
  ingestUrl: string;
  /** Show the ingest URL under the key (default true; /setup shows it separately). */
  showIngestUrl?: boolean;
};

/**
 * One-time reveal of a freshly created sync key: the key in a sunken
 * monospace field, a big Copy button with a check animation, a "you won't
 * see this again" warning, and the ingest URL with its own copy button.
 */
export function KeyReveal({ apiKey, ingestUrl, showIngestUrl = true }: KeyRevealProps) {
  const { copied, copy } = useCopy("Key");
  const prefix = apiKey.slice(0, 3);
  const rest = apiKey.slice(3);

  return (
    <div data-testid="key-reveal">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="telemetry" style={{ color: SIGNAL.green }}>
          {"// Your sync key"}
        </p>
        <Badge tone="warning">Shown once</Badge>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={spring.soft}
        className="relative overflow-hidden rounded-xl bg-card-sunken px-4 py-3.5"
        style={{
          boxShadow: `inset 0 1px 2px rgb(0 0 0 / 0.55), inset 0 0 0 1px ${alpha(SIGNAL.green, copied ? 55 : 22)}`,
          transition: "box-shadow 300ms ease",
        }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-6 top-0 h-px"
          style={{ background: `linear-gradient(90deg, transparent, ${alpha(SIGNAL.green, 55)}, transparent)` }}
        />
        <code
          data-testid="api-key-value"
          aria-label="Your sync key"
          className="block select-all break-all font-mono text-[15px] leading-[1.55] tracking-[0.01em] text-text"
        >
          <span className="text-muted">{prefix}</span>
          {rest}
        </code>
      </motion.div>

      <Button
        variant="signal"
        color={SIGNAL.green}
        size="lg"
        fullWidth
        className="mt-3"
        onClick={() => copy(apiKey, "Paste it into the Huddle Sync Shortcut.")}
        icon={<CopyGlyph copied={copied} />}
        aria-label={copied ? "Key copied" : "Copy key"}
      >
        {copied ? "Copied" : "Copy key"}
      </Button>

      <p
        role="note"
        className="mt-3 flex items-start gap-2 rounded-xl px-3 py-2.5 text-[13px] leading-snug"
        style={{ color: SIGNAL.yellow, background: alpha(SIGNAL.yellow, 8), boxShadow: `inset 0 0 0 1px ${alpha(SIGNAL.yellow, 20)}` }}
      >
        <WarnIcon />
        <span>
          You won&rsquo;t see this again &mdash; save it to the Shortcut now.
        </span>
      </p>

      {showIngestUrl && (
        <div className="mt-4">
          <CopyField label="Ingest URL" value={ingestUrl} testId="ingest-url" />
        </div>
      )}
    </div>
  );
}
