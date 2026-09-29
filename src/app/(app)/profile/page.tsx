import { signOutAction } from "@/app/(auth)/actions";
import { SubmitButton } from "@/components/auth/SubmitButton";
import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui/Card";
import { Stagger, StaggerItem } from "@/components/ui/Stagger";
import { requireOnboardedUser } from "@/lib/session";

export const metadata = { title: "Profile" };

export default async function ProfilePage() {
  const user = await requireOnboardedUser();
  const name = user.displayName ?? user.name ?? user.username ?? "You";

  return (
    <>
      <PageHeader title="Profile" subtitle="Account" />
      <Stagger className="space-y-3 px-4">
        <StaggerItem>
          <Card>
            <p className="label mb-3">Signed in as</p>
            <p className="font-display text-[28px] font-semibold uppercase leading-none tracking-[0.02em]">
              {name}
            </p>
            <p className="telemetry mt-2 normal-case tracking-normal">{user.email}</p>
            {user.isAdmin && (
              <p className="telemetry mt-3" style={{ color: "var(--strain)" }}>
                Admin
              </p>
            )}
          </Card>
        </StaggerItem>
        <StaggerItem>
          <Card>
            <p className="label mb-2">Coming soon</p>
            <p className="text-[15px] leading-relaxed text-muted">
              Your avatar and settings will live here.
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
    </>
  );
}
