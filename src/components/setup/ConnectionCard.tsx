"use client";

import { useCallback, useState, useTransition, type ReactNode } from "react";
import { CopyField, KeyReveal } from "@/components/apikey/KeyReveal";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmSheet } from "@/components/ui/ConfirmSheet";
import { useToast } from "@/components/ui/Toast";
import { regenerateKeyAction, type KeyStatusDTO } from "@/lib/apikey-actions";
import { SIGNAL } from "@/lib/ui/colors";
import { formatRelative, formatShortDate } from "@/lib/ui/format";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-9 items-baseline justify-between gap-4 py-1.5">
      <dt className="text-[14px] text-muted">{label}</dt>
      <dd className="num min-w-0 truncate text-right text-[15px] font-medium text-text">{children}</dd>
    </div>
  );
}

const LockIcon = () => (
  <svg aria-hidden width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="mt-[2px] shrink-0">
    <rect x="4" y="9" width="12" height="8.5" rx="2" />
    <path d="M6.8 9V6.6a3.2 3.2 0 0 1 6.4 0V9" />
  </svg>
);

type ConnectionCardProps = {
  ingestUrl: string;
  status: KeyStatusDTO;
  onStatus: (s: KeyStatusDTO) => void;
  /** Plaintext of a key made on this page (shown once), or null. */
  revealed: string | null;
  onRevealed: (key: string | null) => void;
};

/**
 * "Your connection": the ingest URL, the key's hint and dates, and "Show a
 * new key" (confirm → regenerate → one-time inline reveal). Keys are stored
 * hashed, so the current one can never be shown again; a new one replaces it.
 */
export function ConnectionCard({ ingestUrl, status, onStatus, revealed, onRevealed }: ConnectionCardProps) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const closeConfirm = useCallback(() => setConfirming(false), []);

  const regenerate = () =>
    startTransition(async () => {
      try {
        const r = await regenerateKeyAction();
        if (!r.ok) {
          toast({ title: "Couldn't make a new key", description: r.error, tone: "error" });
          return;
        }
        onStatus(r.status);
        onRevealed(r.key);
        setConfirming(false);
      } catch {
        toast({ title: "Couldn't make a new key", description: "Couldn't reach the server. Try again.", tone: "error" });
      }
    });

  return (
    <section id="connection" aria-labelledby="connection-title" className="surface scroll-mt-4 p-5">
      <div className="mb-1 flex items-center justify-between gap-3">
        <p className="telemetry">{"// Your connection"}</p>
        {status.active ? <Badge tone="success">Key active</Badge> : <Badge tone="danger">No key</Badge>}
      </div>
      <h2 id="connection-title" className="mb-4 font-display text-[26px] font-semibold uppercase leading-none tracking-[0.02em]">
        URL and key
      </h2>

      <CopyField label="Ingest URL" value={ingestUrl} testId="ingest-url" />

      <div className="mt-5">
        {revealed ? (
          <>
            <KeyReveal apiKey={revealed} ingestUrl={ingestUrl} showIngestUrl={false} />
            <p className="mt-3 text-[13px] leading-snug text-muted">
              Your previous key has stopped working. Paste this one into the Shortcut&rsquo;s <span className="text-text-2">HuddleKey</span>{" "}
              text (step 01 below).
            </p>
            <Button variant="ghost" size="md" fullWidth className="mt-1" onClick={() => onRevealed(null)}>
              Hide key
            </Button>
          </>
        ) : status.active ? (
          <>
            <p className="label mb-1">API key</p>
            <dl className="divide-y divide-hairline">
              <Row label="Key">
                <span data-testid="key-hint" className="font-mono text-[14px]">
                  {status.prefixHint}
                  <span className="text-dim">{"••••"}</span>
                </span>
              </Row>
              <Row label="Created">{status.createdAt ? formatShortDate(new Date(status.createdAt)) : "—"}</Row>
              <Row label="Last used">
                <span suppressHydrationWarning className={status.lastUsedAt ? undefined : "text-muted"}>
                  {status.lastUsedAt ? formatRelative(new Date(status.lastUsedAt)) : "Never"}
                </span>
              </Row>
            </dl>
            <Button variant="secondary" size="md" fullWidth className="mt-4" onClick={() => setConfirming(true)}>
              Show a new key
            </Button>
          </>
        ) : (
          <>
            <p className="text-[14px] leading-snug text-muted">
              Your Shortcut needs a personal key to send your Health data. Create one, then paste it into the Shortcut.
            </p>
            <Button variant="primary" size="md" fullWidth className="mt-4" loading={pending} onClick={regenerate}>
              Create key
            </Button>
          </>
        )}
      </div>

      <p className="mt-4 flex items-start gap-2 text-[12.5px] leading-snug text-muted">
        <span style={{ color: SIGNAL.green }}>
          <LockIcon />
        </span>
        <span>
          The Shortcut sends the key in the <span className="font-mono text-[12px] text-text-2">Authorization</span> header.
          Avoid <span className="font-mono text-[12px] text-text-2">?key=</span> URLs: they can end up in proxy and browser logs.
        </span>
      </p>

      <ConfirmSheet
        open={confirming}
        onClose={closeConfirm}
        onConfirm={regenerate}
        title="Show a new key?"
        confirmLabel="Make a new key"
        pending={pending}
      >
        Huddle only stores a scrambled copy of your key, so it can&rsquo;t show the current one again. A new key replaces it:
        the old one stops working right away, and you&rsquo;ll paste the new one into your Shortcut.
      </ConfirmSheet>
    </section>
  );
}
