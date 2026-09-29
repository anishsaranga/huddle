"use client";

import { useOptimistic } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ConfirmSheet } from "@/components/ui/ConfirmSheet";
import { EmptyState } from "@/components/ui/EmptyState";
import { Stagger, StaggerItem } from "@/components/ui/Stagger";
import type { AdminUserRow, UserStatus } from "@/lib/admin/users";
import { formatShortDate } from "@/lib/ui/format";
import type { SyncSummary } from "@/lib/sync-status";
import { deactivateUserAction, reactivateUserAction } from "../actions";
import { useAdminAction } from "./useAdminAction";
import { useConfirm } from "./useConfirm";

export type UserListItem = AdminUserRow & { sync: SyncSummary; isSelf: boolean };

type Change = { id: string; status: UserStatus };

function relativeSync(sync: SyncSummary): string {
  if (!sync.lastSyncAt) return "Never synced";
  return formatShortDate(sync.lastSyncAt);
}

export function UsersList({ users }: { users: UserListItem[] }) {
  const [optimistic, setStatus] = useOptimistic(users, (list, change: Change) =>
    list.map((u) => (u.id === change.id ? { ...u, status: change.status } : u)),
  );
  const { run } = useAdminAction();
  const confirm = useConfirm<UserListItem>();

  function deactivate(user: UserListItem) {
    confirm.close();
    run(() => deactivateUserAction(user.id), {
      optimistic: () => setStatus({ id: user.id, status: "deactivated" }),
    });
  }

  function reactivate(user: UserListItem) {
    run(() => reactivateUserAction(user.id), {
      // Back to active/not-onboarded; the server refresh settles the exact value.
      optimistic: () => setStatus({ id: user.id, status: user.onboarded ? "active" : "not_onboarded" }),
    });
  }

  if (optimistic.length === 0) {
    return (
      <EmptyState title="No users yet">People appear here the first time they sign in.</EmptyState>
    );
  }

  return (
    <>
      <p className="label mb-3">{optimistic.length} {optimistic.length === 1 ? "user" : "users"}</p>
      <Stagger className="space-y-2">
        {optimistic.map((u) => (
          <StaggerItem key={u.id}>
            <UserCard
              user={u}
              onDeactivate={() => confirm.ask(u)}
              onReactivate={() => reactivate(u)}
            />
          </StaggerItem>
        ))}
      </Stagger>

      <ConfirmSheet
        open={confirm.open}
        onClose={confirm.close}
        onConfirm={() => confirm.target && deactivate(confirm.target)}
        title="Deactivate user?"
        confirmLabel="Deactivate"
        destructive
      >
        <p>
          <span className="font-medium text-text">
            {confirm.target?.displayName ?? confirm.target?.email}
          </span>{" "}
          is signed out everywhere now and can&rsquo;t sign in until you reactivate them.
        </p>
        <p className="mt-3">Their data is kept. Their sync key will stop working too.</p>
      </ConfirmSheet>
    </>
  );
}

const statusBadge: Record<UserStatus, { tone: "success" | "danger" | "warning"; label: string }> = {
  active: { tone: "success", label: "Active" },
  deactivated: { tone: "danger", label: "Deactivated" },
  not_onboarded: { tone: "warning", label: "Not onboarded" },
};

function UserCard({
  user,
  onDeactivate,
  onReactivate,
}: {
  user: UserListItem;
  onDeactivate: () => void;
  onReactivate: () => void;
}) {
  const label = user.displayName ?? user.email;
  const badge = statusBadge[user.status];
  return (
    <article aria-label={`User ${user.email}`}>
    <Card padding="p-4">
      <div className="flex items-start gap-3">
        <Avatar label={label} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[16px] font-semibold leading-tight text-text">
            {user.displayName ?? "Not onboarded yet"}
          </p>
          <p className="font-mono text-[12px] leading-tight text-muted mt-1 truncate ">
            {user.username ? `@${user.username}` : "no username"}
          </p>
          <p className="font-mono text-[12px] leading-tight text-muted mt-0.5 truncate ">{user.email}</p>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {user.isAdmin && <Badge tone="admin">Admin</Badge>}
            <Badge tone={badge.tone}>{badge.label}</Badge>
          </div>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-hairline pt-3">
        <Stat label="Last sync" value={relativeSync(user.sync)} muted={!user.sync.lastSyncAt} />
        <Stat
          label="Days covered"
          value={user.sync.daysCovered === null ? "—" : String(user.sync.daysCovered)}
          muted={user.sync.daysCovered === null}
        />
        <Stat label="Joined" value={formatShortDate(user.createdAt)} />
      </dl>

      {!user.isAdmin && !user.isSelf && (
        <div className="mt-4">
          {user.status === "deactivated" ? (
            <Button variant="secondary" fullWidth onClick={onReactivate}>
              Reactivate
            </Button>
          ) : (
            <Button variant="secondary" fullWidth onClick={onDeactivate} className="!text-recovery-red">
              Deactivate
            </Button>
          )}
        </div>
      )}
    </Card>
    </article>
  );
}

function Stat({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="telemetry">{label}</dt>
      <dd className={`num mt-1 truncate text-[14px] font-medium ${muted ? "text-muted" : "text-text"}`}>
        {value}
      </dd>
    </div>
  );
}
