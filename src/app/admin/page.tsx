import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/session";

export default async function AdminIndex() {
  await requireAdmin();
  redirect("/admin/allowlist");
}
