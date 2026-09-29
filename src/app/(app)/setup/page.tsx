import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui/Card";
import { Stagger, StaggerItem } from "@/components/ui/Stagger";

export const metadata = { title: "Sync setup" };

/** Placeholder: the step-by-step Shortcut guide arrives with API keys (M3). */
export default function SetupPage() {
  return (
    <>
      <PageHeader title="Sync setup" subtitle="iPhone Shortcut" />
      <Stagger className="space-y-3 px-4">
        <StaggerItem>
          <Card>
            <p className="label mb-2">Guide coming soon</p>
            <p className="text-[15px] leading-relaxed text-muted">
              Huddle reads your Apple Health data through an iOS Shortcut. The step-by-step setup guide, with your
              personal sync key, lands here shortly.
            </p>
          </Card>
        </StaggerItem>
      </Stagger>
    </>
  );
}
