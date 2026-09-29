"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { avatarUrl } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { useToast } from "@/components/ui/Toast";
import { saveAvatarConfigAction, saveSectionAction } from "@/lib/profile/actions";
import {
  bodySchema,
  fieldErrors,
  goalsSchema,
  personalSchema,
  preferencesSchema,
  SLEEP_GOAL_MIN,
  STEP_GOAL,
  sexSchema,
} from "@/lib/profile/schema";
import type { ProfileActionResult, ProfileData } from "@/lib/profile/types";
import { defaultConfigForSeed } from "@/lib/avatar/config";
import { AvatarPicker, type AvatarDraft } from "./AvatarPicker";
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
} from "./fields";
import { useUsernameStatus } from "./useUsernameStatus";
import { runtimeTimezone } from "@/lib/admin/timezones";
import type { Units } from "@/db/schema";

export type SheetKind = "avatar" | "personal" | "body" | "goals" | "preferences";

type Errors = Record<string, string>;

/** Form + sticky Save button + error line, shared by every edit sheet. */
function FormShell({
  onSubmit,
  pending,
  error,
  label = "Save",
  children,
}: {
  onSubmit: () => void;
  pending: boolean;
  error: string | null;
  label?: string;
  children: ReactNode;
}) {
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!pending) onSubmit();
  };
  return (
    <form onSubmit={submit} noValidate className="space-y-6 pt-2">
      {children}
      <div className="sticky bottom-0 -mx-5 bg-gradient-to-t from-card-elevated from-70% to-transparent px-5 pb-1 pt-4">
        {error && (
          <p role="alert" className="mb-3 text-center text-[13px] leading-snug text-recovery-red">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" size="lg" fullWidth loading={pending}>
          {label}
        </Button>
      </div>
    </form>
  );
}

/** Runs a save action with a pending flag; toasts "Saved" and closes on success. */
function useSaver(onDone: () => void) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Errors>({});

  const save = (action: () => Promise<ProfileActionResult>, message = "Saved") => {
    setFormError(null);
    startTransition(async () => {
      let r: ProfileActionResult;
      try {
        r = await action();
      } catch {
        r = { ok: false, error: "Couldn't reach the server. Try again." };
      }
      if (r.ok) {
        toast({ title: message, tone: "success" });
        onDone();
      } else if (r.field) {
        setErrors({ [r.field]: r.error });
      } else {
        setFormError(r.error);
      }
    });
  };
  const clear = (...keys: string[]) =>
    setErrors((prev) => {
      if (!keys.some((k) => k in prev)) return prev;
      const next = { ...prev };
      for (const k of keys) delete next[k];
      return next;
    });
  return { pending, formError, errors, setErrors, save, clear };
}

// ---------------------------------------------------------------------------
// Personal
// ---------------------------------------------------------------------------

function PersonalForm({ user, onDone }: { user: ProfileData; onDone: () => void }) {
  const [displayName, setDisplayName] = useState(user.displayName ?? "");
  const [username, setUsername] = useState(user.username ?? "");
  const [dob, setDob] = useState(user.dob ?? "");
  const parsedSex = sexSchema.safeParse(user.sex);
  const [sex, setSex] = useState(parsedSex.success ? parsedSex.data : null);
  const status = useUsernameStatus(username, { own: user.username });
  const { pending, formError, errors, setErrors, save, clear } = useSaver(onDone);

  const submit = () => {
    const data = { displayName, username, dob, sex };
    const e = fieldErrors(personalSchema, data);
    if (status.state === "taken") e.username = status.message;
    setErrors(e);
    if (Object.keys(e).length) return;
    save(() => saveSectionAction("personal", data));
  };

  return (
    <FormShell onSubmit={submit} pending={pending} error={formError}>
      <DisplayNameField
        value={displayName}
        onChange={(v) => {
          setDisplayName(v);
          clear("displayName");
        }}
        error={errors.displayName}
      />
      <UsernameField
        value={username}
        onChange={(v) => {
          setUsername(v);
          clear("username");
        }}
        status={status}
        error={errors.username}
      />
      <DobField
        value={dob}
        onChange={(v) => {
          setDob(v);
          clear("dob");
        }}
        error={errors.dob}
      />
      <SexField
        value={sex}
        onChange={(v) => {
          setSex(v);
          clear("sex");
        }}
        error={errors.sex}
      />
    </FormShell>
  );
}

// ---------------------------------------------------------------------------
// Body
// ---------------------------------------------------------------------------

function BodyForm({ user, onDone }: { user: ProfileData; onDone: () => void }) {
  const units: Units = user.units ?? "metric";
  const [heightCm, setHeightCm] = useState<number | null>(user.heightCm);
  const [weightKg, setWeightKg] = useState<number | null>(user.weightKg);
  const [maxHr, setMaxHr] = useState<number | null>(user.maxHr);
  const { pending, formError, errors, setErrors, save, clear } = useSaver(onDone);

  const submit = () => {
    const data = { heightCm, weightKg, maxHr };
    const e = fieldErrors(bodySchema, data);
    setErrors(e);
    if (Object.keys(e).length) return;
    save(() => saveSectionAction("body", data));
  };

  return (
    <FormShell onSubmit={submit} pending={pending} error={formError}>
      <HeightField
        units={units}
        valueCm={heightCm}
        onChange={(v) => {
          setHeightCm(v);
          clear("heightCm");
        }}
        error={errors.heightCm}
      />
      <WeightField
        units={units}
        valueKg={weightKg}
        onChange={(v) => {
          setWeightKg(v);
          clear("weightKg");
        }}
        error={errors.weightKg}
      />
      <MaxHrField
        value={maxHr}
        onChange={(v) => {
          setMaxHr(v);
          clear("maxHr");
        }}
        dob={user.dob}
        error={errors.maxHr}
      />
    </FormShell>
  );
}

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

function GoalsForm({ user, onDone }: { user: ProfileData; onDone: () => void }) {
  const [stepGoal, setStepGoal] = useState(user.stepGoal ?? STEP_GOAL.default);
  const [sleepGoalMin, setSleepGoalMin] = useState(user.sleepGoalMin ?? SLEEP_GOAL_MIN.default);
  const { pending, formError, errors, setErrors, save } = useSaver(onDone);

  const submit = () => {
    const data = { stepGoal, sleepGoalMin };
    const e = fieldErrors(goalsSchema, data);
    setErrors(e);
    if (Object.keys(e).length) return;
    save(() => saveSectionAction("goals", data));
  };

  return (
    <FormShell onSubmit={submit} pending={pending} error={formError}>
      <StepGoalField compact value={stepGoal} onChange={setStepGoal} error={errors.stepGoal} />
      <div className="h-px bg-hairline" />
      <SleepGoalField compact value={sleepGoalMin} onChange={setSleepGoalMin} error={errors.sleepGoalMin} />
    </FormShell>
  );
}

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

function PreferencesForm({ user, onDone }: { user: ProfileData; onDone: () => void }) {
  const [timezone, setTimezone] = useState(user.timezone ?? runtimeTimezone());
  const [units, setUnits] = useState<Units>(user.units ?? "metric");
  const { pending, formError, errors, setErrors, save } = useSaver(onDone);

  const submit = () => {
    const data = { timezone, units };
    const e = fieldErrors(preferencesSchema, data);
    setErrors(e);
    if (Object.keys(e).length) return;
    save(() => saveSectionAction("preferences", data));
  };

  return (
    <FormShell onSubmit={submit} pending={pending} error={formError}>
      <TimezoneField value={timezone} detected={runtimeTimezone()} onChange={setTimezone} error={errors.timezone} />
      <UnitsField value={units} onChange={setUnits} />
    </FormShell>
  );
}

// ---------------------------------------------------------------------------
// Avatar
// ---------------------------------------------------------------------------

function AvatarForm({ user, onDone, onUploaded }: { user: ProfileData; onDone: () => void; onUploaded: () => void }) {
  const [draft, setDraft] = useState<AvatarDraft>(() => ({
    mode: user.avatarKind === "upload" ? "upload" : "character",
    config: user.avatarConfig ?? defaultConfigForSeed(user.id),
    photoUrl: user.avatarKind === "upload" ? avatarUrl(user) : null,
  }));
  const { pending, formError, save } = useSaver(onDone);

  const submit = () => {
    if (draft.mode === "upload") {
      // The photo was saved the moment it was uploaded.
      if (draft.photoUrl) return onDone();
      return;
    }
    save(() => saveAvatarConfigAction(draft.config), "Avatar saved");
  };

  return (
    <FormShell
      onSubmit={submit}
      pending={pending}
      error={formError}
      label={draft.mode === "upload" ? "Done" : "Save avatar"}
    >
      <AvatarPicker
        value={draft}
        onChange={(next) => {
          if (next.photoUrl !== draft.photoUrl && next.photoUrl) {
            onUploaded();
          }
          setDraft(next);
        }}
      />
    </FormShell>
  );
}

// ---------------------------------------------------------------------------
// Host
// ---------------------------------------------------------------------------

const TITLES: Record<SheetKind, string> = {
  avatar: "Your avatar",
  personal: "Personal",
  body: "Body",
  goals: "Goals",
  preferences: "Preferences",
};

/** The one sheet the Profile page opens at a time. */
export function EditSheets({ user, open, onClose }: { user: ProfileData; open: SheetKind | null; onClose: () => void }) {
  const router = useRouter();
  const uploadedRef = useRef(false);

  // After an upload the server-rendered profile is stale; refresh when the sheet closes.
  const close = useCallback(() => {
    if (uploadedRef.current) {
      uploadedRef.current = false;
      router.refresh();
    }
    onClose();
  }, [router, onClose]);

  // Keep the last kind mounted while the sheet animates out.
  const [last, setLast] = useState<SheetKind>("personal");
  if (open && open !== last) setLast(open);
  const kind = open ?? last;

  return (
    <Sheet open={open !== null} onClose={close} title={TITLES[kind]}>
      {kind === "personal" && <PersonalForm user={user} onDone={close} />}
      {kind === "body" && <BodyForm user={user} onDone={close} />}
      {kind === "goals" && <GoalsForm user={user} onDone={close} />}
      {kind === "preferences" && <PreferencesForm user={user} onDone={close} />}
      {kind === "avatar" && (
        <AvatarForm
          user={user}
          onDone={close}
          onUploaded={() => {
            uploadedRef.current = true;
          }}
        />
      )}
    </Sheet>
  );
}

