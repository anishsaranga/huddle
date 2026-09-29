import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui/Card";
import { Stagger, StaggerItem } from "@/components/ui/Stagger";

export const metadata = { title: "Community" };

export default function CommunityPage() {
  return (
    <>
      <PageHeader title="Community" subtitle="Groups" />
      <Stagger className="space-y-3 px-4">
        <StaggerItem>
          <Card>
            <p className="label mb-2">Coming soon</p>
            <p className="text-[15px] leading-relaxed text-muted">
              Your groups, leaderboards and chat will live here.
            </p>
          </Card>
        </StaggerItem>
      </Stagger>
    </>
  );
}
