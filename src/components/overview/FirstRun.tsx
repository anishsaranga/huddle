"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { AmbientGlow } from "@/components/ui/AmbientGlow";
import { Stagger, StaggerItem } from "@/components/ui/Stagger";
import { alpha, SIGNAL } from "@/lib/ui/colors";
import { ease, PRESS_SCALE, spring } from "@/lib/ui/motion";

const MotionLink = motion.create(Link);

const RINGS = [
  { r: 92, color: SIGNAL.green, to: 0.78, label: "Recovery" },
  { r: 72, color: SIGNAL.strain, to: 0.56, label: "Strain" },
  { r: 52, color: SIGNAL.sleep, to: 0.88, label: "Sleep" },
];

/**
 * Nested recovery / strain / sleep rings that draw on in sequence, then turn
 * very slowly: the dials this screen will show once data arrives.
 */
function Rings() {
  const reduced = useReducedMotion();
  const size = 212;
  const c = size / 2;
  return (
    <div className="relative mx-auto" style={{ width: size, height: size }} aria-hidden>
      <div
        className="absolute -inset-10 rounded-full"
        style={{ background: `radial-gradient(circle, ${alpha(SIGNAL.strain, 16)} 0%, transparent 62%)` }}
      />
      <motion.svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="relative overflow-visible"
        style={{ rotate: -90 }}
        animate={reduced ? undefined : { rotate: [-90, 270] }}
        transition={reduced ? undefined : { duration: 60, repeat: Infinity, ease: "linear" }}
      >
        <defs>
          <filter id="firstrun-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="5" />
          </filter>
        </defs>
        {RINGS.map((ring, i) => (
          <g key={ring.label}>
            <circle cx={c} cy={c} r={ring.r} fill="none" style={{ stroke: "var(--track)" }} strokeWidth={11} />
            {[true, false].map((blur) => (
              <motion.circle
                key={String(blur)}
                cx={c}
                cy={c}
                r={ring.r}
                fill="none"
                style={{ stroke: ring.color }}
                strokeWidth={11}
                strokeLinecap="round"
                filter={blur ? "url(#firstrun-glow)" : undefined}
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: ring.to, opacity: blur ? 0.5 : 1 }}
                transition={
                  reduced
                    ? { duration: 0 }
                    : {
                        pathLength: { duration: 1.6, delay: 0.25 + i * 0.22, ease: ease.outExpo },
                        opacity: { duration: 0.3, delay: 0.25 + i * 0.22 },
                      }
                }
              />
            ))}
          </g>
        ))}
      </motion.svg>
      <div className="absolute inset-0 grid place-items-center">
        <motion.svg
          width="34"
          height="34"
          viewBox="0 0 24 24"
          fill="none"
          stroke="white"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={reduced ? { duration: 0 } : { ...spring.soft, delay: 1.1 }}
        >
          {/* iPhone */}
          <rect x="6.5" y="2.5" width="11" height="19" rx="2.6" />
          <path d="M10.5 5h3" />
          <path d="M9.5 13.2c.9-1.8 1.7-3.2 2.5-3.2s1.3 1.8 2 3.4c.5-.7 1-1 1.5-1" opacity="0.8" />
        </motion.svg>
      </div>
    </div>
  );
}

const STEPS = [
  ["01", "Add the Huddle Shortcut", "One tap from the setup page."],
  ["02", "Paste your personal key", "It links your iPhone to your account."],
  ["03", "Run your first sync", "Up to a year of Apple Health history."],
] as const;

/** Home before the first sync: the setup card replaces the dials. */
export function FirstRun({ name }: { name: string | null }) {
  return (
    <div className="relative isolate min-h-full">
      <AmbientGlow color={SIGNAL.strain} intensity={0.8} />
      <header className="pt-safe px-safe">
        <div className="px-5 pt-6">
          <p className="telemetry">{name ? `Welcome, ${name}` : "Welcome to Huddle"}</p>
        </div>
      </header>

      <Stagger delay={0.1} className="space-y-3 px-4 pt-6">
        <StaggerItem>
          <section aria-labelledby="first-run-title" className="surface surface-elevated overflow-hidden px-5 pb-6 pt-8">
            <Rings />
            <h1
              id="first-run-title"
              className="mt-8 text-center font-display text-[38px] font-bold uppercase leading-[0.92] tracking-[0.02em]"
            >
              Connect your
              <br />
              iPhone
            </h1>
            <p className="mx-auto mt-3 max-w-[30ch] text-center text-[15px] leading-relaxed text-muted">
              Huddle reads Apple Health through a Shortcut. Set it up once and your recovery, strain and sleep land
              here every morning.
            </p>

            <ol className="mt-6 divide-y divide-hairline rounded-[14px] bg-card-sunken/70 px-4 shadow-[inset_0_0_0_1px_var(--hairline)]">
              {STEPS.map(([n, title, sub]) => (
                <li key={n} className="flex items-center gap-3.5 py-3">
                  <span className="telemetry w-5 text-text-2">{n}</span>
                  <span className="min-w-0">
                    <span className="block text-[15px] font-medium leading-tight">{title}</span>
                    <span className="mt-0.5 block text-[13px] leading-snug text-muted">{sub}</span>
                  </span>
                </li>
              ))}
            </ol>

            <MotionLink
              href="/setup"
              whileTap={{ scale: PRESS_SCALE }}
              transition={spring.press}
              className="mt-6 flex h-[52px] w-full items-center justify-center gap-2 rounded-full text-[14px] font-semibold uppercase tracking-[0.12em] text-bg"
              style={{
                background: SIGNAL.strain,
                boxShadow: `0 0 0 1px ${alpha(SIGNAL.strain, 60)} inset, 0 10px 30px -10px ${alpha(SIGNAL.strain, 80)}`,
              }}
            >
              Connect your iPhone
              <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 8h10M9 4l4 4-4 4" />
              </svg>
            </MotionLink>
          </section>
        </StaggerItem>
        <StaggerItem>
          <p className="telemetry px-2 pb-2 pt-1 text-center text-[9.5px] text-dim">
            Works with Apple Watch, Fitbit, Zepp and more, anything that writes to Apple Health.
          </p>
        </StaggerItem>
      </Stagger>
    </div>
  );
}
