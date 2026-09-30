import { notFound } from "next/navigation";
import { db } from "@/db";
import { getGroupDetail } from "@/lib/admin/groups";
import { getWorkerStatus } from "@/lib/admin/worker";
import { getChampionsAdminStatus } from "@/lib/champions/admin";
import { requireAdmin } from "@/lib/session";
import { formatRelative } from "@/lib/ui/format";
import { ChampionsPanel, type WorkerJobView } from "../../_components/ChampionsPanel";
import { GroupDetail } from "../../_components/GroupDetail";

export const metadata = { title: "Group · Admin" };

/** Jobs the worker schedules (listed even before their first run). */
const KNOWN_JOBS = [
  { job: "champions", schedule: "Hourly · posts Mon 09:00 group time" },
  { job: "retention", schedule: "Nightly · 03:17 server time" },
];

export default async function GroupPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const detail = await getGroupDetail(db, id);
  if (!detail) notFound();
  const now = new Date();
  const [champions, heartbeats] = await Promise.all([getChampionsAdminStatus(db, id, now), getWorkerStatus(db)]);

  // Times are formatted here, on the server, so the client renders the same text.
  const known = new Set(KNOWN_JOBS.map((j) => j.job));
  const jobs: WorkerJobView[] = [
    ...KNOWN_JOBS.map((k) => ({ ...k, beat: heartbeats.find((h) => h.job === k.job) })),
    ...heartbeats.filter((h) => !known.has(h.job)).map((h) => ({ job: h.job, schedule: null, beat: h })),
  ].map(({ job, schedule, beat }) => {
    const lastRun = beat?.lastRunAt ?? null;
    const lastOk = beat?.lastOkAt ?? null;
    const state: WorkerJobView["state"] = !lastRun
      ? "never"
      : beat?.lastError
        ? "error"
        : lastOk && lastOk >= lastRun
          ? "ok"
          : "running";
    return {
      job,
      schedule,
      state,
      lastRun: lastRun ? formatRelative(lastRun, now) : null,
      lastOk: lastOk ? formatRelative(lastOk, now) : null,
      error: beat?.lastError ? beat.lastError.split("\n")[0].slice(0, 200) : null,
    };
  });

  return (
    <>
      <GroupDetail {...detail} />
      {champions && (
        <ChampionsPanel
          groupId={id}
          status={champions}
          lastPostLabel={champions.lastPost ? formatRelative(new Date(champions.lastPost.at), now) : null}
          jobs={jobs}
        />
      )}
    </>
  );
}
