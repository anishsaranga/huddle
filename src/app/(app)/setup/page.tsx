import { SetupGuide } from "@/components/setup/SetupGuide";
import { db } from "@/db";
import { getKeyStatus } from "@/lib/apikey";
import { getIngestUrl } from "@/lib/app-url";
import { getEnv } from "@/lib/env";
import { requireOnboardedUser } from "@/lib/session";
import { getShortcutFileUrl } from "@/lib/setup/shortcut-file";
import { getRecentSyncDays, getSyncStatus } from "@/lib/sync-status";

export const metadata = { title: "Sync setup" };

/** The iPhone Shortcut setup guide, personalized with the user's URL, key and sync progress. */
export default async function SetupPage() {
  const user = await requireOnboardedUser();
  const [key, ingestUrl, status, syncDays] = await Promise.all([
    getKeyStatus(db, user.id),
    getIngestUrl(),
    getSyncStatus(db, user.id),
    getRecentSyncDays(db, user.id),
  ]);
  const env = getEnv();

  return (
    <SetupGuide
      ingestUrl={ingestUrl}
      keyStatus={{
        active: key.active,
        prefixHint: key.prefixHint,
        createdAt: key.createdAt?.toISOString() ?? null,
        lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
      }}
      initialStatus={status}
      automated={syncDays >= 2}
      shortcutName={env.SHORTCUT_NAME}
      icloudUrl={env.SHORTCUT_ICLOUD_URL ?? null}
      shortcutFileUrl={getShortcutFileUrl()}
      renderedAt={Date.parse(status.server_time)}
    />
  );
}
