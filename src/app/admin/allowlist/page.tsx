import { db } from "@/db";
import { listAllowlist } from "@/lib/admin/allowlist";
import { getEnv } from "@/lib/env";
import { requireAdmin } from "@/lib/session";
import { AllowlistManager } from "../_components/AllowlistManager";
import { SectionHeader } from "../_components/SectionHeader";

export const metadata = { title: "Allowlist · Admin" };

export default async function AllowlistPage() {
  await requireAdmin();
  const entries = await listAllowlist(db, getEnv().ADMIN_EMAIL);

  return (
    <>
      <SectionHeader kicker="Admin" title="Allowlist">
        Only these Google accounts can sign in.
      </SectionHeader>
      <AllowlistManager entries={entries} />
    </>
  );
}
