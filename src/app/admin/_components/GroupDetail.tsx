"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useOptimistic, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ConfirmSheet } from "@/components/ui/ConfirmSheet";
import { EmptyState } from "@/components/ui/EmptyState";
import { Sheet } from "@/components/ui/Sheet";
import { Stagger, StaggerItem } from "@/components/ui/Stagger";
import type { AddableUser, GroupDetail as GroupDetailData, GroupMemberRow } from "@/lib/admin/groups";
import {
  addGroupMembersAction,
  deleteGroupAction,
  removeGroupMemberAction,
  updateGroupAction,
} from "../actions";
import { GroupForm } from "./GroupForm";
import { IconButton, MinusIcon, PlusIcon } from "./IconButton";
import { useAdminAction } from "./useAdminAction";

export function GroupDetail({ group, members, addable }: GroupDetailData) {
  const router = useRouter();
  const [optimisticMembers, dropMember] = useOptimistic(members, (list, id: string) =>
    list.filter((m) => m.id !== id),
  );
  const edit = useAdminAction();
  const del = useAdminAction();
  const add = useAdminAction();
  const remove = useAdminAction();

  const [editOpen, setEditOpen] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <>
      <header className="mb-5">
        <Link
          href="/admin/groups"
          className="telemetry -ml-2 mb-3 inline-flex h-9 items-center gap-1 px-2 text-text-2 active:opacity-60"
        >
          <svg
            aria-hidden
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m10 3.5-4.5 4.5L10 12.5" />
          </svg>
          All groups
        </Link>
        <p className="telemetry mb-2">{group.timezone.replaceAll("_", " ")}</p>
        <h1 className="font-display text-[40px] font-bold uppercase leading-[0.9] tracking-[0.02em] [overflow-wrap:anywhere]">
          {group.name}
        </h1>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              setEditError(null);
              setEditOpen(true);
            }}
          >
            Edit
          </Button>
          <Button variant="secondary" onClick={() => setDeleteOpen(true)} className="!text-recovery-red">
            Delete
          </Button>
        </div>
      </header>

      <section aria-label="Members">
        <div className="mb-3 flex items-center justify-between">
          <p className="label">Members · {optimisticMembers.length}</p>
          <Button
            size="sm"
            variant="primary"
            icon={<PlusIcon />}
            disabled={addable.length === 0}
            onClick={() => setPickerOpen(true)}
          >
            Add
          </Button>
        </div>

        {optimisticMembers.length === 0 ? (
          <EmptyState title="No members">
            {addable.length > 0
              ? "Add people so they show up in this group."
              : "Nobody to add yet. People appear here once they've signed in."}
          </EmptyState>
        ) : (
          <Stagger className="space-y-2">
            {optimisticMembers.map((m) => (
              <StaggerItem key={m.id}>
                <MemberRow
                  member={m}
                  onRemove={() =>
                    remove.run(() => removeGroupMemberAction(group.id, m.id), {
                      optimistic: () => dropMember(m.id),
                      successTitle: `Removed ${m.label}`,
                    })
                  }
                />
              </StaggerItem>
            ))}
          </Stagger>
        )}
      </section>

      <Sheet open={editOpen} onClose={() => setEditOpen(false)} title="Edit group">
        <GroupForm
          initial={{ name: group.name, timezone: group.timezone }}
          submitLabel="Save changes"
          pending={edit.pending}
          error={editError}
          onClearError={() => setEditError(null)}
          onSubmit={({ name, timezone }) =>
            edit.run(() => updateGroupAction(group.id, name, timezone), {
              onSuccess: () => setEditOpen(false),
              onError: setEditError,
            })
          }
        />
      </Sheet>

      <ConfirmSheet
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Delete group?"
        confirmLabel="Delete group"
        destructive
        pending={del.pending}
        onConfirm={() =>
          del.run(() => deleteGroupAction(group.id), {
            onSuccess: () => {
              setDeleteOpen(false);
              router.replace("/admin/groups");
            },
            onError: () => setDeleteOpen(false),
          })
        }
      >
        <p>
          <span className="font-medium text-text">{group.name}</span> and its{" "}
          {members.length === 1 ? "1 membership" : `${members.length} memberships`} will be removed.
        </p>
        <p className="mt-3">The people themselves and their data are not affected.</p>
      </ConfirmSheet>

      <Sheet open={pickerOpen} onClose={() => setPickerOpen(false)} title="Add members">
        <MemberPicker
          people={addable}
          pending={add.pending}
          onSubmit={(ids) =>
            add.run(() => addGroupMembersAction(group.id, ids), {
              onSuccess: () => setPickerOpen(false),
            })
          }
        />
      </Sheet>
    </>
  );
}

function MemberRow({ member, onRemove }: { member: GroupMemberRow; onRemove: () => void }) {
  return (
    <Card padding="p-3.5">
      <div className="flex items-center gap-3">
        <Avatar label={member.label} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold leading-tight text-text">{member.label}</p>
          <p className="font-mono text-[12px] leading-tight text-muted mt-1 truncate ">
            {member.username ? `@${member.username} · ` : ""}
            {member.email}
          </p>
          {member.status !== "active" && (
            <div className="mt-2">
              {member.status === "deactivated" ? (
                <Badge tone="danger">Deactivated</Badge>
              ) : (
                <Badge tone="warning">Not onboarded</Badge>
              )}
            </div>
          )}
        </div>
        <IconButton label={`Remove ${member.label}`} onClick={onRemove} danger>
          <MinusIcon />
        </IconButton>
      </div>
    </Card>
  );
}

const FILTER_THRESHOLD = 6;

function MemberPicker({
  people,
  pending,
  onSubmit,
}: {
  people: AddableUser[];
  pending: boolean;
  onSubmit: (ids: string[]) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const shown = q
    ? people.filter((p) => `${p.label} ${p.email} ${p.username ?? ""}`.toLowerCase().includes(q))
    : people;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div>
      {people.length > FILTER_THRESHOLD && (
        <input
          type="search"
          aria-label="Filter people"
          placeholder="Filter people"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="mb-3 h-12 w-full rounded-xl bg-card-sunken px-4 text-[16px] text-text placeholder:text-dim shadow-[inset_0_1px_2px_rgb(0_0_0/0.5),inset_0_0_0_1px_var(--hairline-strong)] outline-none focus-visible:shadow-[inset_0_0_0_1.5px_rgb(255_255_255/0.6)]"
        />
      )}
      <ul className="space-y-1.5">
        {shown.map((p) => {
          const on = selected.has(p.id);
          return (
            <li key={p.id}>
              <label
                className={`relative flex min-h-[60px] cursor-pointer items-center gap-3 rounded-2xl px-3 py-2 shadow-[inset_0_0_0_1px_var(--hairline)] transition-colors active:bg-white/[0.06] ${
                  on ? "bg-white/[0.07] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.35)]" : "bg-white/[0.02]"
                }`}
              >
                <input
                  type="checkbox"
                  className="peer sr-only"
                  checked={on}
                  onChange={() => toggle(p.id)}
                  aria-label={p.label}
                />
                <Avatar label={p.label} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold leading-tight">{p.label}</span>
                  <span className="font-mono text-[12px] leading-tight text-muted mt-1 block truncate ">
                    {p.username ? `@${p.username} · ` : ""}
                    {p.email}
                  </span>
                </span>
                <span
                  aria-hidden
                  className={`flex size-6 shrink-0 items-center justify-center rounded-full transition-colors peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-white/70 ${
                    on ? "bg-white text-bg" : "shadow-[inset_0_0_0_1.5px_var(--hairline-strong)]"
                  }`}
                >
                  {on && (
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m3.5 8.5 3 3 6-7" />
                    </svg>
                  )}
                </span>
              </label>
            </li>
          );
        })}
        {shown.length === 0 && (
          <li className="py-6 text-center text-[15px] text-muted">No one matches &ldquo;{query}&rdquo;.</li>
        )}
      </ul>
      <Button
        size="lg"
        fullWidth
        className="mt-5"
        loading={pending}
        disabled={selected.size === 0}
        onClick={() => onSubmit([...selected])}
      >
        {selected.size === 0 ? "Pick people to add" : `Add ${selected.size} ${selected.size === 1 ? "person" : "people"}`}
      </Button>
    </div>
  );
}
