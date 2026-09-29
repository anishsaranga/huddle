"use client";

import { useOptimistic, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ConfirmSheet } from "@/components/ui/ConfirmSheet";
import { EmptyState } from "@/components/ui/EmptyState";
import { Stagger, StaggerItem } from "@/components/ui/Stagger";
import { TextField } from "@/components/ui/TextField";
import type { AllowlistEntry } from "@/lib/admin/allowlist";
import { addAllowedEmailAction, removeAllowedEmailAction } from "../actions";
import { IconButton, LockIcon, TrashIcon } from "./IconButton";
import { useAdminAction } from "./useAdminAction";
import { useConfirm } from "./useConfirm";

type Change = { type: "add"; email: string } | { type: "remove"; email: string };

function reduce(entries: AllowlistEntry[], change: Change): AllowlistEntry[] {
  if (change.type === "remove") return entries.filter((e) => e.email !== change.email);
  if (entries.some((e) => e.email === change.email)) return entries;
  return [...entries, { email: change.email, pinned: false, addedAt: null, user: null }];
}

export function AllowlistManager({ entries }: { entries: AllowlistEntry[] }) {
  const [optimistic, apply] = useOptimistic(entries, reduce);
  const add = useAdminAction();
  const rm = useAdminAction();
  const confirm = useConfirm<AllowlistEntry>();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  const joined = optimistic.filter((e) => e.user).length;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = email.trim().toLowerCase();
    if (!value) {
      setError("Enter an email address");
      return;
    }
    setError(null);
    add.run(() => addAllowedEmailAction(value), {
      optimistic: () => apply({ type: "add", email: value }),
      onSuccess: () => setEmail(""),
      onError: setError,
    });
  }

  function remove(entry: AllowlistEntry) {
    confirm.close();
    rm.run(() => removeAllowedEmailAction(entry.email), {
      optimistic: () => apply({ type: "remove", email: entry.email }),
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <form onSubmit={submit} noValidate className="space-y-3">
          <TextField
            label="Add an email"
            type="email"
            inputMode="email"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="friend@gmail.com"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (error) setError(null);
            }}
            error={error}
            hint={error ? undefined : "Use the Google account they'll sign in with."}
          />
          <Button type="submit" size="lg" fullWidth loading={add.pending}>
            Add to allowlist
          </Button>
        </form>
      </Card>

      <section aria-label="Allowed emails">
        <p className="label mb-3">
          {optimistic.length} allowed · {joined} joined
        </p>
        {optimistic.length === 0 ? (
          <EmptyState title="Nobody yet">Add a friend&rsquo;s email above so they can sign in.</EmptyState>
        ) : (
          <Stagger className="space-y-2">
            {optimistic.map((entry) => (
              <StaggerItem key={entry.email}>
                <AllowlistRow entry={entry} onRemove={() => confirm.ask(entry)} />
              </StaggerItem>
            ))}
          </Stagger>
        )}
      </section>

      <ConfirmSheet
        open={confirm.open}
        onClose={confirm.close}
        onConfirm={() => confirm.target && remove(confirm.target)}
        title="Remove email?"
        confirmLabel="Remove"
        destructive
      >
        <p>
          <span className="break-all font-medium text-text">{confirm.target?.email}</span> won&rsquo;t be able
          to sign in any more, and any device they&rsquo;re signed in on is signed out now.
        </p>
        <p className="mt-3">Their account and data are kept. Add the email again to let them back in.</p>
      </ConfirmSheet>
    </div>
  );
}

function AllowlistRow({ entry, onRemove }: { entry: AllowlistEntry; onRemove: () => void }) {
  const { user } = entry;
  const label = user?.displayName ?? entry.email;
  return (
    <Card padding="p-3.5">
      <div className="flex items-center gap-3">
        <Avatar label={label} />
        <div className="min-w-0 flex-1">
          {user?.displayName && (
            <p className="truncate text-[15px] font-semibold leading-tight text-text">{user.displayName}</p>
          )}
          <p
            className={`truncate ${
              user?.displayName ? "font-mono text-[12px] leading-tight text-muted mt-1 " : "text-[15px] font-semibold text-text"
            }`}
          >
            {entry.email}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {entry.pinned && <Badge tone="admin">Admin</Badge>}
            {user ? <Badge tone="success">Joined</Badge> : <Badge>Invited</Badge>}
            {user?.deactivated && <Badge tone="danger">Deactivated</Badge>}
          </div>
        </div>
        {entry.pinned ? (
          <span className="flex size-11 shrink-0 items-center justify-center text-dim" title="Always allowed">
            <span className="sr-only">Always allowed</span>
            <LockIcon />
          </span>
        ) : (
          <IconButton label={`Remove ${entry.email}`} onClick={onRemove} danger>
            <TrashIcon />
          </IconButton>
        )}
      </div>
    </Card>
  );
}
