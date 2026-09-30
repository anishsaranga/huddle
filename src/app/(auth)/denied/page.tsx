import type { Metadata } from "next";
import Link from "next/link";
import { SubmitButton } from "@/components/auth/SubmitButton";
import { HuddleMark } from "@/components/brand/HuddleMark";
import { AmbientGlow } from "@/components/ui/AmbientGlow";
import { Card } from "@/components/ui/Card";
import { Stagger, StaggerItem } from "@/components/ui/Stagger";
import { SIGNAL } from "@/lib/ui/colors";
import { switchAccount } from "../actions";

export const metadata: Metadata = { title: "Not on the list" };

export default function DeniedPage() {
  return (
    <>
      <AmbientGlow color={SIGNAL.red} intensity={0.55} />

      <Stagger className="flex flex-1 flex-col" delay={0.05} stagger={0.09}>
        <StaggerItem className="flex items-center justify-between pt-5">
          <Link href="/login" aria-label="Huddle sign in" className="-m-2 p-2">
            <HuddleMark size={28} animate={false} />
          </Link>
          <span className="telemetry" style={{ color: SIGNAL.red }}>
            Access denied
          </span>
        </StaggerItem>

        <div className="flex flex-1 flex-col justify-center py-10">
          <StaggerItem index={1}>
            <p className="telemetry mb-4">Invite only</p>
          </StaggerItem>
          <StaggerItem index={2}>
            <h1 className="font-display text-[64px] font-bold uppercase leading-[0.86] tracking-[0.01em]">
              You&rsquo;re not on the list
            </h1>
          </StaggerItem>
          <StaggerItem index={3}>
            <p className="mt-6 text-[20px] font-medium leading-snug text-text">
              Ask the admin to add you.
            </p>
          </StaggerItem>
          <StaggerItem index={4}>
            <Card className="mt-8" padding="p-4">
              <p className="text-[14px] leading-relaxed text-muted">
                Huddle is a private group. Once your email is on the allowlist, sign in with that same
                Google account.
              </p>
            </Card>
          </StaggerItem>
        </div>

        <StaggerItem index={5} className="space-y-2 pb-6">
          <form action={switchAccount}>
            <SubmitButton variant="secondary" size="lg" fullWidth>
              Try another account
            </SubmitButton>
          </form>
          <Link
            href="/login"
            className="flex h-11 items-center justify-center text-[13px] font-semibold uppercase tracking-[0.12em] text-text-2"
          >
            Back to sign in
          </Link>
        </StaggerItem>
      </Stagger>
    </>
  );
}
