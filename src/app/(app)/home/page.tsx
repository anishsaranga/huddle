import { db } from "@/db";
import { FirstRun } from "@/components/overview/FirstRun";
import { Overview } from "@/components/overview/Overview";
import { resolveDashboardDate } from "@/lib/dashboard/dates";
import { loadDashboardContext } from "@/lib/dashboard/load";
import { buildOverviewView } from "@/lib/dashboard/overview-view";
import { getOverview, getTrend } from "@/lib/scores/queries";
import { requireOnboardedUser } from "@/lib/session";

export const metadata = { title: "Home" };

export default async function HomePage({ searchParams }: PageProps<"/home">) {
  const user = await requireOnboardedUser();
  const ctx = await loadDashboardContext(user);
  if (!ctx.everSynced) return <FirstRun name={user.displayName?.split(" ")[0] ?? user.name?.split(" ")[0] ?? null} />;

  const date = resolveDashboardDate((await searchParams).date, ctx.today, ctx.span.firstDate);
  const [overview, recovery] = await Promise.all([
    getOverview(db, user.id, date),
    // Calendar dots: the last six months of recovery, ending today.
    getTrend(db, user.id, "recovery", "6m", ctx.today),
  ]);

  const view = buildOverviewView(overview, {
    today: ctx.today,
    tz: ctx.tz,
    h12: ctx.h12,
    facts: ctx.facts,
    firstDate: ctx.span.firstDate,
    now: ctx.now,
  });

  return (
    <Overview
      view={view}
      firstDate={ctx.span.firstDate}
      calendar={recovery.filter((p) => p.value !== null).map((p) => [p.date, p.value])}
    />
  );
}
