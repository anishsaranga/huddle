"use client";

import { useTransition } from "react";
import { signOutAction } from "@/app/(auth)/actions";
import { AvatarPicker, type AvatarDraft } from "@/components/profile/AvatarPicker";
import {
  DisplayNameField,
  DobField,
  HeightField,
  MaxHrField,
  SexField,
  SleepGoalField,
  StepGoalField,
  TimezoneField,
  UnitsField,
  UsernameField,
  WeightField,
} from "@/components/profile/fields";
import type { UsernameStatus } from "@/components/profile/useUsernameStatus";
import { Card } from "@/components/ui/Card";
import type { Units } from "@/db/schema";
import type { Sex } from "@/lib/profile/schema";

/*
 * Presentational onboarding steps. The flow (OnboardingFlow) owns the draft,
 * validation and saving; each step just renders fields for its slice.
 */

export type OnboardingDraft = {
  username: string;
  displayName: string;
  avatar: AvatarDraft;
  timezone: string | null;
  units: Units | null;
  dob: string;
  sex: Sex | null;
  heightCm: number | null;
  weightKg: number | null;
  maxHr: number | null;
  stepGoal: number;
  sleepGoalMin: number;
};

type Errors = Record<string, string>;

type StepProps = {
  draft: OnboardingDraft;
  patch: (p: Partial<OnboardingDraft>) => void;
  errors: Errors;
};

export function IdentityStep({
  draft,
  patch,
  errors,
  usernameStatus,
}: StepProps & { usernameStatus: UsernameStatus }) {
  const [signingOut, startTransition] = useTransition();
  return (
    <div className="space-y-6">
      <UsernameField
        value={draft.username}
        onChange={(username) => patch({ username })}
        status={usernameStatus}
        error={errors.username}
      />
      <DisplayNameField
        value={draft.displayName}
        onChange={(displayName) => patch({ displayName })}
        error={errors.displayName}
      />
      <p className="pt-2 text-center text-[13px] text-muted">
        Wrong account?{" "}
        <button
          type="button"
          disabled={signingOut}
          onClick={() => startTransition(() => signOutAction())}
          className="font-semibold text-text-2 underline decoration-hairline-strong underline-offset-[3px]"
        >
          Sign out
        </button>
      </p>
    </div>
  );
}

export function AvatarStep({ draft, patch, errors }: StepProps) {
  return (
    <div>
      <AvatarPicker value={draft.avatar} onChange={(avatar) => patch({ avatar })} />
      {errors.avatar && (
        <p role="alert" className="mt-3 text-center text-[13px] text-recovery-red">
          {errors.avatar}
        </p>
      )}
    </div>
  );
}

export function BasicsStep({
  draft,
  patch,
  errors,
  device,
}: StepProps & { device: { timezone: string; units: Units } }) {
  return (
    <div className="space-y-6">
      <TimezoneField
        value={draft.timezone ?? device.timezone}
        detected={device.timezone}
        onChange={(timezone) => patch({ timezone })}
        error={errors.timezone}
      />
      <UnitsField value={draft.units ?? device.units} onChange={(units) => patch({ units })} />
      <DobField value={draft.dob} onChange={(dob) => patch({ dob })} error={errors.dob} />
      <SexField value={draft.sex} onChange={(sex) => patch({ sex })} error={errors.sex} />
    </div>
  );
}

export function BodyStep({ draft, patch, errors, units }: StepProps & { units: Units }) {
  return (
    <div className="space-y-6">
      <HeightField
        key={`h-${units}`}
        units={units}
        valueCm={draft.heightCm}
        onChange={(heightCm) => patch({ heightCm })}
        error={errors.heightCm}
      />
      <WeightField
        key={`w-${units}`}
        units={units}
        valueKg={draft.weightKg}
        onChange={(weightKg) => patch({ weightKg })}
        error={errors.weightKg}
      />
      <MaxHrField value={draft.maxHr} onChange={(maxHr) => patch({ maxHr })} dob={draft.dob || null} error={errors.maxHr} />
    </div>
  );
}

export function GoalsStep({ draft, patch, errors }: StepProps) {
  return (
    <div className="space-y-4">
      <Card>
        <StepGoalField value={draft.stepGoal} onChange={(stepGoal) => patch({ stepGoal })} error={errors.stepGoal} />
      </Card>
      <Card>
        <SleepGoalField
          value={draft.sleepGoalMin}
          onChange={(sleepGoalMin) => patch({ sleepGoalMin })}
          error={errors.sleepGoalMin}
        />
      </Card>
    </div>
  );
}
