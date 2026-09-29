import { notFound } from "next/navigation";
import { memberGroup } from "@/lib/groups/access";
import { requireOnboardedUser } from "@/lib/session";

/**
 * Members only (admins get no exemption). Checked here, outside the page's
 * loading boundary, so a non-member or unknown id is a real 404 response.
 */
export default async function GroupLayout({ children, params }: LayoutProps<"/groups/[id]">) {
  const user = await requireOnboardedUser();
  const { id } = await params;
  if (!(await memberGroup(id, user.id))) notFound();
  return children;
}
