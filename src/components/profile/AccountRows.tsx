"use client";

import { useCallback, useState, useTransition, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { TextField } from "@/components/ui/TextField";
import { deleteAccountAction } from "@/lib/account/actions";
import { SIGNAL } from "@/lib/ui/colors";

const rowClass = "flex min-h-[64px] w-full items-center gap-3 px-5 py-3 text-left transition-colors active:bg-white/[0.04]";

function RowBody({ label, hint, danger }: { label: string; hint: string; danger?: boolean }) {
  return (
    <span className="min-w-0 flex-1">
      <span className="block text-[15px] font-medium leading-tight" style={{ color: danger ? SIGNAL.red : "var(--text)" }}>
        {label}
      </span>
      <span className="mt-1 block text-[13px] leading-snug text-muted">{hint}</span>
    </span>
  );
}

const downloadIcon = (
  <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-dim">
    <path d="M8 2.5v8m0 0L4.8 7.3M8 10.5l3.2-3.2M3 13h10" />
  </svg>
);

/**
 * "Export my data": a plain anchor (not next/link, so nothing prefetches it and burns the rate limit).
 * Navigating to a route that answers with `Content-Disposition: attachment` is what makes iOS Safari,
 * including the standalone PWA, offer its download sheet.
 */
export function ExportRow() {
  return (
    <a href="/api/me/export" data-testid="export-data" className={rowClass}>
      <RowBody label="Export my data" hint="Download everything as JSON" />
      {downloadIcon}
    </a>
  );
}

function Consequence({ children }: { children: ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span aria-hidden className="mt-[9px] size-1.5 shrink-0 rounded-full" style={{ background: SIGNAL.red }} />
      <span>{children}</span>
    </li>
  );
}

/** "Delete account": explains what goes, asks for the username, then calls `deleteAccountAction`. */
export function DeleteAccountRow({ username, isAdmin }: { username: string | null; isAdmin: boolean }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const close = useCallback(() => {
    if (pending) return;
    setOpen(false);
    setTyped("");
    setError(null);
  }, [pending]);

  const matches = !!username && typed.trim().replace(/^@/, "").toLowerCase() === username.toLowerCase();

  const submit = () =>
    startTransition(async () => {
      setError(null);
      try {
        const r = await deleteAccountAction(typed);
        // Success redirects to /login and never returns here.
        if (r && !r.ok) setError(r.error);
      } catch (err) {
        // Next's redirect is signalled by throwing; let it through.
        if (err && typeof err === "object" && "digest" in err && String((err as { digest: unknown }).digest).startsWith("NEXT_REDIRECT")) throw err;
        setError("Couldn't reach the server. Try again.");
      }
    });

  if (isAdmin) {
    return (
      <div aria-disabled="true" className="flex min-h-[64px] items-center gap-3 px-5 py-3 opacity-55">
        <RowBody label="Delete account" hint="The admin account can't be deleted" />
      </div>
    );
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} data-testid="delete-account" className={rowClass}>
        <RowBody label="Delete account" hint="Remove your account and data" danger />
      </button>

      <Sheet open={open} onClose={close} title="Delete account">
        <p className="text-[15px] leading-relaxed text-text-2">This can&rsquo;t be undone.</p>
        <ul className="mt-3 space-y-2 text-[15px] leading-snug text-muted">
          <Consequence>Your profile, sync key, health data, scores and group memberships are deleted for good.</Consequence>
          <Consequence>Your chat messages stay in the groups, shown as &ldquo;Deleted user&rdquo;.</Consequence>
          <Consequence>Your email is removed from the allowlist, so an admin has to add it again before you can rejoin.</Consequence>
          <Consequence>Want a copy first? Export your data before you continue.</Consequence>
        </ul>

        <form
          className="mt-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (matches && !pending) submit();
          }}
        >
          <TextField
            label={username ? `Type ${username} to confirm` : "Type your username to confirm"}
            value={typed}
            onChange={(e) => {
              setTyped(e.target.value);
              setError(null);
            }}
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            disabled={pending}
            error={error}
            data-testid="delete-confirm-input"
          />
          <div className="mt-5 space-y-2">
            <Button
              type="submit"
              size="lg"
              fullWidth
              variant="signal"
              color={SIGNAL.red}
              loading={pending}
              disabled={!matches}
              data-testid="delete-confirm"
            >
              Delete my account
            </Button>
            <Button type="button" size="lg" fullWidth variant="secondary" onClick={close} disabled={pending}>
              Cancel
            </Button>
          </div>
        </form>
      </Sheet>
    </>
  );
}
