import { redirect } from "next/navigation";
import { OnboardingKey } from "@/components/apikey/OnboardingKey";
import { OnboardingFlow, type OnboardingInitial } from "@/components/onboarding/OnboardingFlow";
import { avatarUrl } from "@/components/ui/Avatar";
import { getIngestUrl } from "@/lib/app-url";
import { defaultConfigForSeed, parseAvatarConfig } from "@/lib/avatar/config";
import { resumeStep } from "@/lib/profile/progress";
import { sexSchema } from "@/lib/profile/schema";
import { requireUser } from "@/lib/session";

export const metadata = { title: "Welcome" };

/**
 * Setup flow for new users. Every step is saved to the user row as it is
 * completed, so a refresh resumes at the first incomplete step; only Finish
 * sets `onboarded_at`.
 */
export default async function OnboardingPage() {
  const user = await requireUser();
  if (user.onboardedAt) redirect("/home");

  const sex = sexSchema.safeParse(user.sex);
  const initial: OnboardingInitial = {
    userId: user.id,
    username: user.username,
    displayName: user.displayName ?? user.name ?? "",
    avatarKind: user.avatarKind,
    avatarConfig: parseAvatarConfig(user.avatarConfig) ?? defaultConfigForSeed(user.id),
    photoUrl: user.avatarKind === "upload" ? avatarUrl(user) : null,
    timezone: user.timezone,
    units: user.units,
    dob: user.dob,
    sex: sex.success ? sex.data : null,
    heightCm: user.heightCm,
    weightKg: user.weightKg,
    maxHr: user.maxHr,
    stepGoal: user.stepGoal,
    sleepGoalMin: user.sleepGoalMin,
    startStep: resumeStep(user),
  };

  // The key is created client-side only once the final step is reached (see OnboardingKey).
  const keySlot = <OnboardingKey userId={user.id} ingestUrl={await getIngestUrl()} />;
  return <OnboardingFlow initial={initial} connectKeySlot={keySlot} />;
}
