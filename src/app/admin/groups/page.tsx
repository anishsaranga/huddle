import { db } from "@/db";
import { listGroups } from "@/lib/admin/groups";
import { requireAdmin } from "@/lib/session";
import { GroupsManager } from "../_components/GroupsManager";

export const metadata = { title: "Groups · Admin" };

export default async function GroupsPage() {
  const admin = await requireAdmin();
  const groups = await listGroups(db);
  return <GroupsManager groups={groups} adminTimezone={admin.timezone} />;
}
