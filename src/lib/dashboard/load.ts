import "server-only";
import { db } from "@/db";
import type { User } from "@/db/schema";
import { resolveDashboardDate } from "@/lib/dashboard/dates";
import type { DeviceFacts } from "@/lib/dashboard/explain";
import { getDataSpan, getOverview, type DataSpan, type Overview } from "@/lib/scores/queries";
import { todayIn } from "@/lib/tz";

export type DashboardContext = {
  span: DataSpan;
  facts: DeviceFacts;
  tz: string;
  today: string;
  now: Date;
  /** 12-hour clock for imperial users, 24-hour otherwise. */
  h12: boolean;
  /** Any successful sync or any stored data. */
  everSynced: boolean;
};

export async function loadDashboardContext(user: User): Promise<DashboardContext> {
  const span = await getDataSpan(db, user.id);
  const now = new Date();
  const tz = user.timezone || "UTC";
  return {
    span,
    facts: { hasHrv: span.hasHrv, hasResp: span.hasResp, hasRhr: span.hasRhr },
    tz,
    today: todayIn(tz, now),
    now,
    h12: user.units === "imperial",
    everSynced: span.lastSyncAt !== null || span.firstDate !== null,
  };
}

/** Context + the resolved `?date=` + that day's overview (shared by Home and the detail screens). */
export async function loadDashboardDay(
  user: User,
  requested: string | string[] | undefined,
): Promise<{ ctx: DashboardContext; date: string; overview: Overview }> {
  const ctx = await loadDashboardContext(user);
  const date = resolveDashboardDate(requested, ctx.today, ctx.span.firstDate);
  const overview = await getOverview(db, user.id, date);
  return { ctx, date, overview };
}
