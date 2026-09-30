import type { Metadata } from "next";
import { HuddleMark } from "@/components/brand/HuddleMark";
import { OfflineRetry } from "@/components/pwa/OfflineRetry";
import { AmbientGlow } from "@/components/ui/AmbientGlow";
import { Stagger, StaggerItem } from "@/components/ui/Stagger";
import { NEUTRAL_SIGNAL, SIGNAL } from "@/lib/ui/colors";

export const metadata: Metadata = {
  title: "Offline",
  description: "Huddle needs a connection to load your scores.",
};

/**
 * Served by the service worker when a navigation can't reach the server, so it
 * is prerendered (no user data, no session) and precached. Keep it static.
 */
export default function OfflinePage() {
  return (
    <>
      <AmbientGlow color={NEUTRAL_SIGNAL} intensity={0.6} />

      <Stagger className="flex flex-1 flex-col" delay={0.05} stagger={0.09}>
        <StaggerItem index={0} className="flex items-center justify-between pt-5">
          <span className="telemetry flex items-center gap-2">
            <span className="size-1.5 rounded-full" style={{ background: SIGNAL.yellow, boxShadow: `0 0 8px ${SIGNAL.yellow}` }} />
            No signal
          </span>
          <span className="telemetry text-dim">Offline</span>
        </StaggerItem>

        <div className="flex flex-1 flex-col justify-center py-10">
          <StaggerItem index={1}>
            <HuddleMark size={72} animate={false} className="-ml-1 mb-9 opacity-45" />
          </StaggerItem>
          <StaggerItem index={2}>
            <h1 className="font-display text-[72px] font-bold uppercase leading-[0.84] tracking-[0.01em]">
              You&rsquo;re offline
            </h1>
          </StaggerItem>
          <StaggerItem index={3}>
            <p className="mt-5 max-w-[22rem] text-[17px] leading-snug text-text-2">
              Huddle needs a connection to load your scores. Nothing is lost: your data is safe and syncing picks up
              where it left off.
            </p>
          </StaggerItem>
          <StaggerItem index={4}>
            <p className="telemetry mt-6 flex items-center gap-2">
              <span aria-hidden className="relative inline-flex size-1.5">
                <span className="animate-dot-pulse absolute inset-0 rounded-full" style={{ background: SIGNAL.strain }} />
                <span className="relative size-1.5 rounded-full" style={{ background: SIGNAL.strain }} />
              </span>
              Waiting for a connection
            </p>
          </StaggerItem>
        </div>

        <StaggerItem index={5} className="pb-6">
          <OfflineRetry />
        </StaggerItem>
      </Stagger>
    </>
  );
}
