import { SyncScreen } from "@/components/sync/SyncScreen";
import { db } from "@/db";
import { getKeyStatus } from "@/lib/apikey";
import { getEnv } from "@/lib/env";
import { requireOnboardedUser } from "@/lib/session";
import { getSyncStatus } from "@/lib/sync-status";

export const metadata = { title: "Sync" };

/** Sync tab: "Sync now" (runs the Shortcut, then listens for its ingest) and the last sync at a glance. */
export default async function SyncPage() {
  const user = await requireOnboardedUser();
  const [key, status] = await Promise.all([getKeyStatus(db, user.id), getSyncStatus(db, user.id)]);
  return (
    <SyncScreen
      initial={status}
      hasKey={key.active}
      shortcutName={getEnv().SHORTCUT_NAME}
      renderedAt={Date.parse(status.server_time)}
    />
  );
}
