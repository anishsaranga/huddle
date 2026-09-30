import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { users } from "@/db/schema";
import { idSchema } from "@/lib/admin/schemas";
import { requireAdmin } from "@/lib/session";

/**
 * Unknown or malformed user ids are a real 404 response. The check lives here,
 * outside the page's loading boundary (loading.tsx sits next to page.tsx), so it
 * runs before any HTML streams. The page still re-checks: layouts don't re-run
 * on client navigation between ids.
 */
export default async function IngestLogLayout({ children, params }: LayoutProps<"/admin/data/[userId]">) {
  await requireAdmin();
  const { userId } = await params;
  if (!idSchema.safeParse(userId).success) notFound();
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
  if (!row) notFound();
  return children;
}
