/**
 * Onboarding progress, derived from the draft fields saved on the user row.
 * Pure, so the page (resume point), the finish action (completeness check)
 * and tests share one definition.
 */

export const ONBOARDING_STEPS = ["identity", "avatar", "basics", "body", "goals", "connect"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export type DraftFields = {
  username: string | null;
  displayName: string | null;
  avatarKind: string | null;
  timezone: string | null;
  units: string | null;
  dob: string | null;
  sex: string | null;
  heightCm: number | null;
  weightKg: number | null;
  stepGoal: number | null;
  sleepGoalMin: number | null;
};

/** Steps whose required fields are still missing (the avatar step is skippable at finish). */
export function incompleteSteps(u: DraftFields): OnboardingStep[] {
  const out: OnboardingStep[] = [];
  if (!u.username || !u.displayName) out.push("identity");
  if (!u.avatarKind) out.push("avatar");
  if (!u.timezone || !u.units || !u.dob || !u.sex) out.push("basics");
  if (u.heightCm == null || u.weightKg == null) out.push("body");
  if (u.stepGoal == null || u.sleepGoalMin == null) out.push("goals");
  return out;
}

/** Where to resume: the first incomplete step, or the final "connect" step. */
export function resumeStep(u: DraftFields): OnboardingStep {
  return incompleteSteps(u)[0] ?? "connect";
}
