import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui/Card";
import { Stagger, StaggerItem } from "@/components/ui/Stagger";

export const metadata = { title: "Profile" };

export default function ProfilePage() {
  return (
    <>
      <PageHeader title="Profile" subtitle="Account" />
      <Stagger className="space-y-3 px-4">
        <StaggerItem>
          <Card>
            <p className="label mb-2">Coming soon</p>
            <p className="text-[15px] leading-relaxed text-muted">
              Your account, avatar and settings will live here.
            </p>
          </Card>
        </StaggerItem>
      </Stagger>
    </>
  );
}
