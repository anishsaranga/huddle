import { PageHeader } from "@/components/PageHeader";

export const metadata = { title: "Community" };

export default function GroupsPage() {
  return (
    <>
      <PageHeader title="Community" />
      <div className="space-y-3 px-5">
        <section className="rounded-2xl border border-hairline bg-card p-5">
          <p className="label mb-2">Coming soon</p>
          <p className="text-[15px] leading-relaxed text-muted">
            Your groups, leaderboards and chat will live here.
          </p>
        </section>
      </div>
    </>
  );
}
