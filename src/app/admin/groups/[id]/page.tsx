import { notFound } from "next/navigation";
import { db } from "@/db";
import { getGroupDetail } from "@/lib/admin/groups";
import { requireAdmin } from "@/lib/session";
import { GroupDetail } from "../../_components/GroupDetail";

export const metadata = { title: "Group · Admin" };

export default async function GroupPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const detail = await getGroupDetail(db, id);
  if (!detail) notFound();
  return <GroupDetail {...detail} />;
}
