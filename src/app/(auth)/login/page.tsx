import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { GoogleIcon } from "@/components/auth/GoogleIcon";
import { SubmitButton } from "@/components/auth/SubmitButton";
import { HuddleMark } from "@/components/brand/HuddleMark";
import { AmbientGlow } from "@/components/ui/AmbientGlow";
import { Stagger, StaggerItem } from "@/components/ui/Stagger";
import { getCurrentUser } from "@/lib/session";
import { SIGNAL } from "@/lib/ui/colors";
import { signInWithGoogle } from "../actions";

export const metadata: Metadata = { title: "Sign in" };

/** Auth.js error codes (and our own "Configuration") → human copy. */
function errorCopy(code: string | undefined): string | null {
  if (!code) return null;
  if (code === "Configuration") return "Sign-in isn't set up yet. Try again a little later.";
  return "Sign-in didn't finish. Please try again.";
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[]; deleted?: string | string[] }>;
}) {
  if (await getCurrentUser()) redirect("/home");

  const { error, deleted } = await searchParams;
  const message = errorCopy(Array.isArray(error) ? error[0] : error);
  const wasDeleted = (Array.isArray(deleted) ? deleted[0] : deleted) === "1";

  return (
    <>
      <AmbientGlow color={SIGNAL.strain} intensity={0.9} />

      <Stagger className="flex flex-1 flex-col" delay={0.05} stagger={0.09}>
        <StaggerItem className="flex items-center justify-between pt-5">
          <span className="telemetry flex items-center gap-2">
            <span className="relative inline-flex size-1.5">
              <span className="animate-dot-pulse absolute inset-0 rounded-full bg-recovery-green" />
              <span className="relative size-1.5 rounded-full bg-recovery-green" />
            </span>
            Private group
          </span>
          <span className="telemetry text-dim">Invite only</span>
        </StaggerItem>

        <div className="flex flex-1 flex-col justify-center py-10">
          <StaggerItem>
            <HuddleMark size={112} delay={0.15} className="-ml-2 mb-9" />
          </StaggerItem>
          <StaggerItem>
            <h1 className="font-display text-[96px] font-bold uppercase leading-[0.82] tracking-[0.01em]">
              Huddle
            </h1>
          </StaggerItem>
          <StaggerItem>
            <p className="mt-5 max-w-[20rem] text-[17px] leading-snug text-text-2">
              Recovery, strain and sleep. Measured together, with your people.
            </p>
          </StaggerItem>
          <StaggerItem>
            <ul aria-label="Tracks" className="mt-9 grid grid-cols-3 gap-3 border-t border-hairline pt-4">
              {[
                { label: "Recovery", color: SIGNAL.green },
                { label: "Strain", color: SIGNAL.strain },
                { label: "Sleep", color: SIGNAL.sleep },
              ].map((m) => (
                <li key={m.label} className="telemetry flex items-center gap-1.5">
                  <span className="size-1.5 rounded-full" style={{ background: m.color }} />
                  {m.label}
                </li>
              ))}
            </ul>
          </StaggerItem>
        </div>

        <StaggerItem className="pb-6">
          {wasDeleted && (
            <p
              role="status"
              data-testid="account-deleted"
              className="surface mb-4 px-4 py-3 text-[14px] leading-snug text-text-2"
              style={{ boxShadow: `inset 3px 0 0 ${SIGNAL.green}` }}
            >
              Your account and data were deleted.
            </p>
          )}
          {message && (
            <p
              role="alert"
              className="surface mb-4 px-4 py-3 text-[14px] leading-snug text-text-2"
              style={{ boxShadow: `inset 3px 0 0 ${SIGNAL.red}` }}
            >
              {message}
            </p>
          )}
          <form action={signInWithGoogle}>
            <SubmitButton size="lg" fullWidth icon={<GoogleIcon />}>
              Continue with Google
            </SubmitButton>
          </form>
          <p className="mt-4 text-center text-[13px] leading-relaxed text-muted">
            Not in the group yet? Ask the admin to add your email.
          </p>
        </StaggerItem>
      </Stagger>
    </>
  );
}
