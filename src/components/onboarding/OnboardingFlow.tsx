"use client";

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useState, useTransition, type ReactNode } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { AmbientGlow } from "@/components/ui/AmbientGlow";
import { Button } from "@/components/ui/Button";
import { useUsernameStatus } from "@/components/profile/useUsernameStatus";
import type { AvatarKind, Units } from "@/db/schema";
import type { AvatarConfig } from "@/lib/avatar/key";
import { finishOnboardingAction, saveAvatarConfigAction, saveSectionAction } from "@/lib/profile/actions";
import { ONBOARDING_STEPS, type OnboardingStep } from "@/lib/profile/progress";
import {
  basicsSchema,
  bodySchema,
  fieldErrors,
  goalsSchema,
  identitySchema,
  SLEEP_GOAL_MIN,
  STEP_GOAL,
  type Sex,
} from "@/lib/profile/schema";
import type { ProfileActionResult } from "@/lib/profile/types";
import { SIGNAL } from "@/lib/ui/colors";
import { ease } from "@/lib/ui/motion";
import { ConnectStep } from "./ConnectStep";
import { ProgressBar } from "./ProgressBar";
import { AvatarStep, BasicsStep, BodyStep, GoalsStep, IdentityStep, type OnboardingDraft } from "./steps";
import { useDeviceDefaults } from "./useDeviceDefaults";

export type OnboardingInitial = {
  userId: string;
  username: string | null;
  displayName: string;
  avatarKind: AvatarKind | null;
  avatarConfig: AvatarConfig;
  /** Preview URL when the saved avatar is an uploaded photo. */
  photoUrl: string | null;
  timezone: string | null;
  units: Units | null;
  dob: string | null;
  sex: Sex | null;
  heightCm: number | null;
  weightKg: number | null;
  maxHr: number | null;
  stepGoal: number | null;
  sleepGoalMin: number | null;
  startStep: OnboardingStep;
};

const META: Record<OnboardingStep, { label: string; title: string; sub: string }> = {
  identity: { label: "Identity", title: "Who are you?", sub: "Pick a username your friends will recognize." },
  avatar: { label: "Avatar", title: "Make it yours", sub: "Build a character or upload a photo." },
  basics: { label: "Basics", title: "The basics", sub: "These tune your scores. Friends never see them." },
  body: { label: "Body", title: "Your body", sub: "Used for calories and heart-rate zones." },
  goals: { label: "Goals", title: "Set your goals", sub: "A starting point. You can change these anytime." },
  connect: { label: "Connect", title: "You’re in", sub: "" },
};

const GLOW: Record<OnboardingStep, string> = {
  identity: SIGNAL.sleep,
  avatar: SIGNAL.sleep,
  basics: SIGNAL.sleep,
  body: SIGNAL.sleep,
  goals: SIGNAL.sleep,
  connect: SIGNAL.green,
};

const slide = {
  enter: (dir: number) => ({ x: dir * 40, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir * -40, opacity: 0 }),
};

function fromInitial(i: OnboardingInitial): OnboardingDraft {
  return {
    username: i.username ?? "",
    displayName: i.displayName,
    avatar: {
      mode: i.avatarKind === "upload" && i.photoUrl ? "upload" : "character",
      config: i.avatarConfig,
      photoUrl: i.avatarKind === "upload" ? i.photoUrl : null,
    },
    timezone: i.timezone,
    units: i.units,
    dob: i.dob ?? "",
    sex: i.sex,
    heightCm: i.heightCm,
    weightKg: i.weightKg,
    maxHr: i.maxHr,
    stepGoal: i.stepGoal ?? STEP_GOAL.default,
    sleepGoalMin: i.sleepGoalMin ?? SLEEP_GOAL_MIN.default,
  };
}

const BackIcon = () => (
  <svg aria-hidden width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <path d="m12 4.5-5.5 5.5 5.5 5.5" />
  </svg>
);

/** Full-screen setup stepper. Saves each step to the user row as you go; only Finish marks onboarding done. */
export function OnboardingFlow({ initial, connectKeySlot }: { initial: OnboardingInitial; connectKeySlot?: ReactNode }) {
  const device = useDeviceDefaults();
  const [draft, setDraft] = useState<OnboardingDraft>(() => fromInitial(initial));
  const [stepIdx, setStepIdx] = useState(() => Math.max(0, ONBOARDING_STEPS.indexOf(initial.startStep)));
  const [dir, setDir] = useState(1);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const step = ONBOARDING_STEPS[stepIdx];
  const meta = META[step];
  const units = draft.units ?? device.units;

  const usernameStatus = useUsernameStatus(draft.username, { own: initial.username, enabled: step === "identity" });

  const patch = useCallback((p: Partial<OnboardingDraft>) => {
    setDraft((d) => ({ ...d, ...p }));
    setErrors((prev) => {
      const keys = Object.keys(p);
      if (!keys.some((k) => k in prev)) return prev;
      const next = { ...prev };
      for (const k of keys) delete next[k];
      if ("avatar" in p) delete next.avatar;
      return next;
    });
    setFormError(null);
  }, []);

  const goTo = (idx: number) => {
    setDir(idx >= stepIdx ? 1 : -1);
    setStepIdx(Math.min(Math.max(idx, 0), ONBOARDING_STEPS.length - 1));
    setErrors({});
    setFormError(null);
  };

  /** Run a server action; on success call `onOk`, otherwise show its error. */
  const run = (action: () => Promise<ProfileActionResult>, onOk: () => void) => {
    startTransition(async () => {
      let r: ProfileActionResult;
      try {
        r = await action();
      } catch {
        r = { ok: false, error: "Couldn't reach the server. Try again." };
      }
      if (r.ok) onOk();
      else if (r.field) setErrors({ [r.field]: r.error });
      else setFormError(r.error);
    });
  };

  const finish = (next: "/home" | "/setup") => {
    if (pending) return;
    startTransition(async () => {
      try {
        const r = await finishOnboardingAction(next); // redirects on success
        if (r && !r.ok) {
          const back = ONBOARDING_STEPS.indexOf((r.missing ?? "identity") as OnboardingStep);
          if (back >= 0) goTo(back);
          setFormError(r.error);
        }
      } catch (err) {
        // Next's redirect() surfaces as a navigation, not an error, but never swallow a real failure.
        if (err && typeof err === "object" && "digest" in err) throw err;
        setFormError("Couldn't reach the server. Try again.");
      }
    });
  };

  const submit = () => {
    if (pending) return;
    setFormError(null);
    switch (step) {
      case "identity": {
        const data = { username: draft.username, displayName: draft.displayName };
        const e = fieldErrors(identitySchema, data);
        if (!draft.username.trim()) e.username = "Pick a username";
        if (usernameStatus.state === "taken") e.username = usernameStatus.message;
        if (Object.keys(e).length) return setErrors(e);
        setErrors({});
        return run(() => saveSectionAction("identity", data), () => goTo(stepIdx + 1));
      }
      case "avatar": {
        if (draft.avatar.mode === "upload") {
          if (!draft.avatar.photoUrl) return setErrors({ avatar: "Choose a photo first, or switch to Build a character." });
          return goTo(stepIdx + 1); // the upload already saved itself
        }
        return run(
          () => saveAvatarConfigAction(draft.avatar.config),
          () => {
            patch({ avatar: { ...draft.avatar, photoUrl: null } });
            goTo(stepIdx + 1);
          },
        );
      }
      case "basics": {
        const data = { timezone: draft.timezone ?? device.timezone, units, dob: draft.dob, sex: draft.sex };
        const e = fieldErrors(basicsSchema, data);
        if (Object.keys(e).length) return setErrors(e);
        setErrors({});
        return run(
          () => saveSectionAction("basics", data),
          () => {
            setDraft((d) => ({ ...d, timezone: data.timezone, units: data.units }));
            goTo(stepIdx + 1);
          },
        );
      }
      case "body": {
        const data = { heightCm: draft.heightCm, weightKg: draft.weightKg, maxHr: draft.maxHr };
        const e = fieldErrors(bodySchema, data);
        if (Object.keys(e).length) return setErrors(e);
        setErrors({});
        return run(() => saveSectionAction("body", data), () => goTo(stepIdx + 1));
      }
      case "goals": {
        const data = { stepGoal: draft.stepGoal, sleepGoalMin: draft.sleepGoalMin };
        const e = fieldErrors(goalsSchema, data);
        if (Object.keys(e).length) return setErrors(e);
        setErrors({});
        return run(() => saveSectionAction("goals", data), () => goTo(stepIdx + 1));
      }
      case "connect":
        return finish("/home");
    }
  };

  const isLast = step === "connect";
  const name = draft.displayName.trim() || "friend";
  const avatarNode =
    draft.avatar.mode === "upload" && draft.avatar.photoUrl ? (
      <Avatar src={draft.avatar.photoUrl} size={112} alt="Your avatar" />
    ) : (
      <Avatar
        user={{ id: initial.userId, avatarKind: "dicebear", avatarConfig: draft.avatar.config }}
        label={name}
        size={112}
        alt="Your avatar"
      />
    );

  return (
    <div className="relative isolate flex h-app flex-col overflow-hidden">
      <AmbientGlow color={GLOW[step]} intensity={isLast ? 0.9 : 0.7} />

      <header className="pt-safe px-safe">
        <div className="mx-auto flex h-14 w-full max-w-md items-center gap-2 px-3">
          <button
            type="button"
            onClick={() => goTo(stepIdx - 1)}
            disabled={stepIdx === 0 || pending}
            aria-label="Back"
            tabIndex={stepIdx === 0 ? -1 : 0}
            className={`grid size-11 shrink-0 place-items-center rounded-full text-text-2 transition-opacity ${
              stepIdx === 0 ? "pointer-events-none opacity-0" : "active:bg-white/[0.06]"
            }`}
          >
            <BackIcon />
          </button>
          <ProgressBar current={stepIdx} total={ONBOARDING_STEPS.length} label={meta.label} />
          <span className="telemetry w-11 shrink-0 text-right">
            {String(stepIdx + 1).padStart(2, "0")}/{String(ONBOARDING_STEPS.length).padStart(2, "0")}
          </span>
        </div>
      </header>

      <form
        id="onboarding-form"
        noValidate
        className="relative mx-auto min-h-0 w-full max-w-md flex-1"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <AnimatePresence mode="wait" custom={dir}>
          <motion.div
            key={step}
            custom={dir}
            variants={slide}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.26, ease: ease.out }}
            className="scroll-area absolute inset-0 px-5 pb-8"
          >
            {isLast ? (
              <ConnectStep name={name} username={draft.username} avatar={avatarNode} keySlot={connectKeySlot} />
            ) : (
              <>
                <div className="pb-6 pt-3">
                  <p className="telemetry mb-2">{`// Step ${String(stepIdx + 1).padStart(2, "0")} · ${meta.label}`}</p>
                  <h1 className="font-display text-[44px] font-bold uppercase leading-[0.92] tracking-[0.01em]">{meta.title}</h1>
                  <p className="mt-3 text-[15px] leading-snug text-muted">{meta.sub}</p>
                </div>
                {step === "identity" && (
                  <IdentityStep draft={draft} patch={patch} errors={errors} usernameStatus={usernameStatus} />
                )}
                {step === "avatar" && <AvatarStep draft={draft} patch={patch} errors={errors} />}
                {step === "basics" && (
                  <BasicsStep draft={draft} patch={patch} errors={errors} device={device} />
                )}
                {step === "body" && <BodyStep draft={draft} patch={patch} errors={errors} units={units} />}
                {step === "goals" && <GoalsStep draft={draft} patch={patch} errors={errors} />}
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </form>

      <footer className="relative bg-bg px-safe">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-6 h-6 bg-gradient-to-t from-bg to-transparent" />
        <div
          className="mx-auto w-full max-w-md px-5 pt-3"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 16px)" }}
        >
          {formError && (
            <p role="alert" className="mb-3 text-center text-[13px] leading-snug text-recovery-red">
              {formError}
            </p>
          )}
          <Button type="submit" form="onboarding-form" variant="primary" size="lg" fullWidth loading={pending}>
            {isLast ? "Finish" : "Continue"}
          </Button>
          {isLast && (
            <Button
              variant="ghost"
              size="md"
              fullWidth
              className="mt-1"
              disabled={pending}
              onClick={() => finish("/setup")}
            >
              Set up sync
            </Button>
          )}
        </div>
      </footer>
    </div>
  );
}
