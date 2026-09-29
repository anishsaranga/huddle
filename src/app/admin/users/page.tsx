import { db } from "@/db";
import { listAdminUsers } from "@/lib/admin/users";
import { requireAdmin } from "@/lib/session";
import { getSyncSummaries } from "@/lib/sync-status";
import { SectionHeader } from "../_components/SectionHeader";
import { UsersList } from "../_components/UsersList";

export const metadata = { title: "Users · Admin" };

export default async function UsersPage() {
  const admin = await requireAdmin();
  const rows = await listAdminUsers(db);
  const sync = await getSyncSummaries(rows.map((u) => u.id));

  const users = rows.map((u) => ({
    ...u,
    isSelf: u.id === admin.id,
    sync: sync.get(u.id) ?? { lastSyncAt: null, daysCovered: null },
  }));

  return (
    <>
      <SectionHeader kicker="Admin" title="Users">
        Everyone who has signed in. Deactivating signs them out and blocks them.
      </SectionHeader>
      <UsersList users={users} />
    </>
  );
}
