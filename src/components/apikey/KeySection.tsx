"use client";

import { useCallback, useState, useTransition, type ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ConfirmSheet } from "@/components/ui/ConfirmSheet";
import { Sheet } from "@/components/ui/Sheet";
import { useToast } from "@/components/ui/Toast";
import { regenerateKeyAction, revokeKeyAction, type KeyStatusDTO } from "@/lib/apikey-actions";
import { SIGNAL } from "@/lib/ui/colors";
import { formatRelative, formatShortDate } from "@/lib/ui/format";
import { KeyReveal } from "./KeyReveal";

type Confirming = "regenerate" | "revoke" | null;

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-9 items-baseline justify-between gap-4 py-1.5">
      <dt className="text-[14px] text-muted">{label}</dt>
      <dd className="num min-w-0 truncate text-right text-[15px] font-medium text-text">{children}</dd>
    </div>
  );
}

/**
 * Profile "Sync key" card: the active key's hint and dates, plus Regenerate
 * (confirm, then a one-time reveal sheet) and Revoke (confirm).
 */
export function KeySection({ initial, ingestUrl }: { initial: KeyStatusDTO; ingestUrl: string }) {
  const [status, setStatus] = useState(initial);
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [revealOpen, setRevealOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const closeConfirm = useCallback(() => setConfirming(null), []);
  const closeReveal = useCallback(() => {
    setRevealOpen(false);
    // Drop the plaintext once the sheet has animated away.
    window.setTimeout(() => setRevealed(null), 400);
  }, []);

  const failed = (error: string) => {
    toast({ title: "Couldn't update your key", description: error, tone: "error" });
  };

  const regenerate = () =>
    startTransition(async () => {
      try {
        const r = await regenerateKeyAction();
        if (!r.ok) {
          failed(r.error);
          return;
        }
        setStatus(r.status);
        setConfirming(null);
        setRevealed(r.key);
        setRevealOpen(true);
      } catch {
        failed("Couldn't reach the server. Try again.");
      }
    });

  const revoke = () =>
    startTransition(async () => {
      try {
        const r = await revokeKeyAction();
        if (!r.ok) {
          failed(r.error);
          return;
        }
        setStatus(r.status);
        setConfirming(null);
        toast({ title: "Key revoked", description: "Your Shortcut can't sync until you create a new key.", tone: "neutral" });
      } catch {
        failed("Couldn't reach the server. Try again.");
      }
    });

  return (
    <>
      <Card>
        <div className="mb-1 flex items-center justify-between gap-3">
          <p className="telemetry">{"// Sync key"}</p>
          {status.active ? <Badge tone="success">Active</Badge> : <Badge tone="danger">No key</Badge>}
        </div>
        <h2 className="mb-2 font-display text-[26px] font-semibold uppercase leading-none tracking-[0.02em]">API key</h2>

        {status.active ? (
          <>
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
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Button variant="secondary" size="md" onClick={() => setConfirming("regenerate")}>
                Regenerate
              </Button>
              <Button
                variant="secondary"
                size="md"
                onClick={() => setConfirming("revoke")}
                style={{ color: SIGNAL.red }}
              >
                Revoke
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-[14px] leading-snug text-muted">
              Your iPhone Shortcut needs a key to send your Health data. Create one, then paste it into the Shortcut.
            </p>
            <Button variant="primary" size="md" fullWidth className="mt-4" loading={pending} onClick={regenerate}>
              Create key
            </Button>
          </>
        )}
      </Card>

      <ConfirmSheet
        open={confirming === "regenerate"}
        onClose={closeConfirm}
        onConfirm={regenerate}
        title="Regenerate key?"
        confirmLabel="Regenerate"
        pending={pending}
      >
        Your current key stops working right away. You&rsquo;ll paste the new one into the Huddle Sync Shortcut.
      </ConfirmSheet>

      <ConfirmSheet
        open={confirming === "revoke"}
        onClose={closeConfirm}
        onConfirm={revoke}
        title="Revoke key?"
        confirmLabel="Revoke key"
        destructive
        pending={pending}
      >
        Your Shortcut stops syncing immediately. Your data stays; you can create a new key anytime.
      </ConfirmSheet>

      <Sheet open={revealOpen} onClose={closeReveal} title="Your new key">
        {revealed && (
          <>
            <KeyReveal apiKey={revealed} ingestUrl={ingestUrl} />
            <Button variant="primary" size="lg" fullWidth className="mt-5" onClick={closeReveal}>
              I&rsquo;ve saved it
            </Button>
          </>
        )}
      </Sheet>
    </>
  );
}
