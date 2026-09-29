import { PageHeader } from "@/components/PageHeader";

export const metadata = { title: "Sync" };

export default function SyncPage() {
  return (
    <>
      <PageHeader title="Sync" />
      <div className="space-y-3 px-5">
        <section className="rounded-2xl border border-hairline bg-card p-5">
          <p className="label mb-2">Coming soon</p>
          <p className="text-[15px] leading-relaxed text-muted">
            Import your health data and see when you last synced.
          </p>
        </section>
      </div>
    </>
  );
}
