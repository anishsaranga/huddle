import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui/Card";
import { Stagger, StaggerItem } from "@/components/ui/Stagger";

export const metadata = { title: "Sync" };

export default function SyncPage() {
  return (
    <>
      <PageHeader title="Sync" subtitle="Health data" />
      <Stagger className="space-y-3 px-4">
        <StaggerItem>
          <Card>
            <p className="label mb-2">Coming soon</p>
            <p className="text-[15px] leading-relaxed text-muted">
              Import your health data and see when you last synced.
            </p>
          </Card>
        </StaggerItem>
      </Stagger>
    </>
  );
}
