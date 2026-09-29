"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/Card";
import { alpha, SIGNAL } from "@/lib/ui/colors";
import { ease, spring } from "@/lib/ui/motion";

type ConnectStepProps = {
  name: string;
  username: string;
  /** The user's avatar, rendered by the caller (keeps DiceBear out of this component). */
  avatar: ReactNode;
  /**
   * Slot for the personal sync key reveal (M3: API keys). Rendered inside the
   * "Connect your iPhone" card. When omitted, a placeholder is shown.
   */
  keySlot?: ReactNode;
};

const RING = 152;
const R = 68;
const CIRC = 2 * Math.PI * R;

/** Avatar pop + ring sweep + two soft shockwaves. */
function Celebration({ avatar }: { avatar: ReactNode }) {
  const reduced = useReducedMotion();
  const color = SIGNAL.green;
  return (
    <div className="relative mx-auto grid place-items-center" style={{ width: RING, height: RING }}>
      {!reduced &&
        [0, 0.18].map((delay) => (
          <motion.span
            key={delay}
            aria-hidden
            className="absolute rounded-full"
            style={{ width: 120, height: 120, boxShadow: `0 0 0 1.5px ${alpha(color, 60)}` }}
            initial={{ scale: 1, opacity: 0.9 }}
            animate={{ scale: 1.9, opacity: 0 }}
            transition={{ duration: 1.3, delay: 0.55 + delay, ease: ease.out }}
          />
        ))}
      <svg aria-hidden width={RING} height={RING} viewBox={`0 0 ${RING} ${RING}`} className="absolute inset-0 -rotate-90">
        <circle cx={RING / 2} cy={RING / 2} r={R} fill="none" stroke="var(--track)" strokeWidth="4" />
        <motion.circle
          cx={RING / 2}
          cy={RING / 2}
          r={R}
          fill="none"
          strokeWidth="4"
          strokeLinecap="round"
          style={{ stroke: color, strokeDasharray: CIRC, filter: `drop-shadow(0 0 6px ${alpha(color, 60)})` }}
          initial={{ strokeDashoffset: CIRC }}
          animate={{ strokeDashoffset: 0 }}
          transition={{ duration: 1.1, delay: 0.25, ease: ease.outExpo }}
        />
      </svg>
      <motion.div
        initial={{ scale: reduced ? 1 : 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ ...spring.bouncy, opacity: { duration: 0.25 } }}
        className="relative flex"
      >
        {avatar}
      </motion.div>
      <motion.span
        aria-hidden
        className="absolute -bottom-0.5 right-3 grid size-9 place-items-center rounded-full text-bg"
        style={{ background: color, boxShadow: `0 0 0 3px var(--bg), 0 0 18px ${alpha(color, 55)}` }}
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ ...spring.bouncy, delay: 0.95 }}
      >
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="m4.5 10.5 3.6 3.6 7.4-8" />
        </svg>
      </motion.span>
    </div>
  );
}

const STEPS = [
  { title: "Get your sync key", body: "A personal key that lets your iPhone talk to Huddle." },
  { title: "Add the Shortcut", body: "One tap to install it from the setup guide." },
  { title: "Run it once", body: "Your first sync fills in recovery, strain and sleep." },
];

/** Final onboarding screen: celebration, then what comes next (the iPhone Shortcut). */
export function ConnectStep({ name, username, avatar, keySlot }: ConnectStepProps) {
  return (
    <div className="pt-2">
      <Celebration avatar={avatar} />

      <motion.div
        className="mt-6 text-center"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...spring.soft, delay: 0.5 }}
      >
        <p className="telemetry" style={{ color: SIGNAL.green }}>
          {"// Setup complete"}
        </p>
        <h1 className="mt-2 font-display text-[64px] font-bold uppercase leading-[0.88] tracking-[0.01em]">You&rsquo;re in</h1>
        <p className="mt-3 text-[15px] text-muted">
          <span className="text-text-2">{name}</span>
          <span className="telemetry ml-2 normal-case tracking-normal">@{username}</span>
        </p>
      </motion.div>

      <motion.div
        className="mt-8"
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...spring.soft, delay: 0.7 }}
      >
        <Card glow={SIGNAL.strain}>
          <p className="telemetry mb-2" style={{ color: SIGNAL.strain }}>
            {"// Next"}
          </p>
          <h2 className="font-display text-[28px] font-semibold uppercase leading-none tracking-[0.02em]">
            Connect your iPhone
          </h2>
          <p className="mt-3 text-[15px] leading-relaxed text-muted">
            Huddle can&rsquo;t read Apple Health directly. An iOS Shortcut on your phone sends your data to your private
            account, so friends only ever see the scores you choose to share.
          </p>

          <ol className="mt-4 space-y-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="flex gap-3">
                <span className="num grid size-6 shrink-0 place-items-center rounded-full bg-white/[0.06] font-mono text-[11px] text-text-2 shadow-[inset_0_0_0_1px_var(--hairline-strong)]">
                  {i + 1}
                </span>
                <span className="min-w-0">
                  <span className="block text-[15px] font-medium leading-tight text-text">{s.title}</span>
                  <span className="mt-0.5 block text-[13px] leading-snug text-muted">{s.body}</span>
                </span>
              </li>
            ))}
          </ol>

          {/* ===== M3 SLOT: personal sync key reveal (API keys) =====
              Pass `keySlot` from the onboarding flow once keys exist. */}
          <div className="mt-5" data-slot="api-key-reveal">
            {keySlot ?? (
              <div className="rounded-xl border border-dashed border-hairline-strong px-4 py-3.5 text-center">
                <p className="telemetry">Your sync key</p>
                <p className="mt-1 text-[13px] leading-snug text-muted">
                  Keys arrive soon. You&rsquo;ll create yours from Profile.
                </p>
              </div>
            )}
          </div>
        </Card>
      </motion.div>
    </div>
  );
}
