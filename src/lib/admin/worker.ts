import { asc } from "drizzle-orm";
import type { Db } from "@/lib/admin/db";
import { workerHeartbeats, type WorkerHeartbeat } from "@/db/schema";

/** One row per job that has ever run, by name (feeds a future admin panel). */
export async function getWorkerStatus(db: Db): Promise<WorkerHeartbeat[]> {
  return db.select().from(workerHeartbeats).orderBy(asc(workerHeartbeats.job));
}
