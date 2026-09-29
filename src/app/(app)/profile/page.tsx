import { PageHeader } from "@/components/PageHeader";

export const metadata = { title: "Profile" };

export default function ProfilePage() {
  return (
    <>
      <PageHeader title="Profile" />
      <div className="space-y-3 px-5">
        <section className="rounded-2xl border border-hairline bg-card p-5">
          <p className="label mb-2">Coming soon</p>
          <p className="text-[15px] leading-relaxed text-muted">
            Your account, avatar and settings will live here.
          </p>
        </section>
      </div>
    </>
  );
}
