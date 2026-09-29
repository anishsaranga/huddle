import { redirect } from "next/navigation";
import { signOutAction } from "@/app/(auth)/actions";
import { SubmitButton } from "@/components/auth/SubmitButton";
import { PageHeader } from "@/components/PageHeader";
import { AmbientGlow } from "@/components/ui/AmbientGlow";
import { Card } from "@/components/ui/Card";
import { Stagger, StaggerItem } from "@/components/ui/Stagger";
import { requireUser } from "@/lib/session";
import { SIGNAL } from "@/lib/ui/colors";

export const metadata = { title: "Welcome" };

/** Placeholder: the real onboarding flow arrives in M2. */
export default async function OnboardingPage() {
  const user = await requireUser();
  if (user.onboardedAt) redirect("/home");

  return (
    <div className="pb-safe relative isolate mx-auto min-h-dvh w-full max-w-md">
      <AmbientGlow color={SIGNAL.sleep} intensity={0.7} />
      <PageHeader title="Welcome" subtitle="Setup" />
      <Stagger className="space-y-3 px-4">
        <StaggerItem>
          <Card>
            <p className="label mb-2">Almost there</p>
            <p className="text-[15px] leading-relaxed text-muted">
              You&rsquo;re in. Profile setup is on its way. Check back soon to pick a username, an
              avatar and your goals.
            </p>
          </Card>
        </StaggerItem>
        <StaggerItem className="pt-3">
          <form action={signOutAction}>
            <SubmitButton variant="secondary" fullWidth>
              Sign out
            </SubmitButton>
          </form>
        </StaggerItem>
      </Stagger>
    </div>
  );
}
