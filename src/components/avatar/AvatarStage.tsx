"use client";

import { AnimatePresence, motion, useAnimationControls, useReducedMotion } from "motion/react";
import { useEffect, useMemo } from "react";
import { seededRng } from "@/lib/avatar/config";
import type { AvatarConfig } from "@/lib/avatar/key";
import { avatarDataUri } from "@/lib/avatar/render";
import { alpha } from "@/lib/ui/colors";

export type StagePulse = { n: number; kind: "pop" | "tick" | "land" };

type AvatarStageProps = {
  config: AvatarConfig;
  pulse: StagePulse;
  /** Preview diameter in px. */
  size?: number;
  corners?: { tl?: string; tr?: string; bl?: string; br?: string };
};

const SPARKS = 9;

/** 4-point sparkle burst + flash ring, remounted per pulse. */
function Burst({ seed, size, color, big }: { seed: number; size: number; color: string; big: boolean }) {
  const sparks = useMemo(() => {
    const rnd = seededRng(`burst:${seed}`);
    return Array.from({ length: SPARKS }, (_, i) => {
        const angle = (i / SPARKS) * Math.PI * 2 + (rnd() - 0.5) * 0.5;
        const dist = size * (big ? 0.62 : 0.56) + rnd() * size * 0.12;
        return {
          x: Math.cos(angle) * dist,
          y: Math.sin(angle) * dist,
          s: 0.7 + rnd() * 0.6,
          d: rnd() * 0.06,
          white: i % 3 !== 0,
        };
      });
  }, [seed, size, big]);
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
      {/* Shockwave ring */}
      <motion.span
        className="absolute rounded-full"
        style={{ width: size, height: size, boxShadow: `0 0 0 2px ${alpha(color, 70)}, 0 0 24px ${alpha(color, 50)}` }}
        initial={{ scale: 1, opacity: 0.9 }}
        animate={{ scale: big ? 1.42 : 1.28, opacity: 0 }}
        transition={{ duration: big ? 0.7 : 0.5, ease: [0.16, 1, 0.3, 1] }}
      />
      {/* Flash over the avatar */}
      <motion.span
        className="absolute rounded-full bg-white"
        style={{ width: size, height: size }}
        initial={{ opacity: big ? 0.55 : 0.32 }}
        animate={{ opacity: 0 }}
        transition={{ duration: big ? 0.45 : 0.3, ease: "easeOut" }}
      />
      {sparks.map((p, i) => (
        <motion.svg
          key={i}
          width="18"
          height="18"
          viewBox="0 0 14 14"
          className="absolute"
          initial={{ x: p.x * 0.72, y: p.y * 0.72, scale: 0, opacity: 1, rotate: 0 }}
          animate={{ x: p.x, y: p.y, scale: [0, p.s * (big ? 1.25 : 1), p.s * 0.6, 0], opacity: [1, 1, 0.9, 0], rotate: 120 }}
          transition={{
            default: { duration: big ? 0.95 : 0.72, delay: p.d, ease: [0.16, 1, 0.3, 1] },
            scale: { duration: big ? 0.95 : 0.72, delay: p.d, times: [0, 0.3, 0.7, 1], ease: "easeOut" },
            opacity: { duration: big ? 0.95 : 0.72, delay: p.d, times: [0, 0.3, 0.7, 1] },
          }}
        >
          <path
            d="M7 0c.5 3.6 2.4 5.5 7 7-4.6 1.5-6.5 3.4-7 7-.5-3.6-2.4-5.5-7-7 4.6-1.5 6.5-3.4 7-7Z"
            style={{ fill: p.white ? "#fff" : color }}
          />
        </motion.svg>
      ))}
    </div>
  );
}

/**
 * The customizer's spotlight stage: a dark, top-lit bay with a light cone,
 * a slow telemetry reticle, a floor shadow and the avatar floating in the
 * middle. Every pulse pops the avatar (overshoot keyframes) and fires a sparkle burst.
 */
export function AvatarStage({ config, pulse, size = 200, corners }: AvatarStageProps) {
  const reduced = useReducedMotion();
  const controls = useAnimationControls();
  const src = avatarDataUri(config);
  const bg = typeof config.options.backgroundColor === "string" ? `#${config.options.backgroundColor}` : "#8c9bff";

  useEffect(() => {
    if (pulse.n === 0 || reduced) return;
    // Keyframed tweens (not springs from a `set`): rapid re-triggers during a
    // shuffle would otherwise inherit runaway velocity from the last spring.
    if (pulse.kind === "tick") {
      void controls.start({
        scale: [0.94, 1],
        y: [-7, 0],
        transition: { duration: 0.14, ease: [0.22, 1, 0.36, 1] },
      });
    } else {
      const land = pulse.kind === "land";
      void controls.start({
        scale: land ? [0.82, 1.09, 0.98, 1] : [0.9, 1.06, 0.99, 1],
        y: 0,
        transition: { duration: land ? 0.62 : 0.46, times: [0, 0.42, 0.75, 1], ease: "easeOut" },
      });
    }
  }, [pulse, reduced, controls]);

  const reticle = size + 44;

  return (
    <div
      role="img"
      aria-label="Avatar preview"
      className="surface relative isolate overflow-hidden rounded-[28px]"
      style={{ height: size + 128 }}
    >
      {/* Avatar-colored wash, crossfades when the background changes. */}
      <AnimatePresence initial={false}>
        <motion.div
          key={bg}
          aria-hidden
          className="absolute inset-0 -z-10"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.6 }}
          style={{
            background: [
              `radial-gradient(circle at 50% 46%, ${alpha(bg, 30)} 0%, ${alpha(bg, 10)} 34%, transparent 62%)`,
              `radial-gradient(ellipse 80% 40% at 50% 100%, ${alpha(bg, 14)}, transparent 70%)`,
            ].join(", "),
          }}
        />
      </AnimatePresence>

      {/* Light cone from above */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 -z-10 h-full opacity-80"
        style={{
          background: "linear-gradient(180deg, rgb(255 255 255 / 0.11) 0%, rgb(255 255 255 / 0.03) 55%, transparent 80%)",
          clipPath: "polygon(36% 0, 64% 0, 92% 100%, 8% 100%)",
        }}
      />
      <div aria-hidden className="grain absolute inset-0 -z-10 opacity-[0.05]" />

      {/* Telemetry corners */}
      {corners && (
        <div aria-hidden className="telemetry pointer-events-none absolute inset-0 p-4">
          <span className="absolute left-4 top-4 text-dim">{corners.tl}</span>
          <span className="absolute right-4 top-4 text-text-2">{corners.tr}</span>
          <span className="absolute bottom-4 left-4 text-dim">{corners.bl}</span>
          <span className="absolute bottom-4 right-4 text-dim">{corners.br}</span>
        </div>
      )}

      <div className="absolute inset-0 flex items-center justify-center" style={{ paddingBottom: 6 }}>
        {/* Reticle */}
        <svg
          aria-hidden
          width={reticle}
          height={reticle}
          viewBox={`0 0 ${reticle} ${reticle}`}
          className="animate-reticle absolute"
        >
          <circle
            cx={reticle / 2}
            cy={reticle / 2}
            r={reticle / 2 - 1}
            fill="none"
            stroke="rgb(255 255 255 / 0.13)"
            strokeWidth="1"
            strokeDasharray="2 7"
          />
          {[0, 90, 180, 270].map((deg) => (
            <line
              key={deg}
              x1={reticle / 2}
              y1={2}
              x2={reticle / 2}
              y2={11}
              stroke="rgb(255 255 255 / 0.4)"
              strokeWidth="1.5"
              strokeLinecap="round"
              transform={`rotate(${deg} ${reticle / 2} ${reticle / 2})`}
            />
          ))}
        </svg>
        <span
          aria-hidden
          className="absolute rounded-full"
          style={{ width: size + 16, height: size + 16, boxShadow: "inset 0 0 0 1px rgb(255 255 255 / 0.07)" }}
        />

        {/* Floor shadow */}
        <span
          aria-hidden
          className="animate-avatar-floor absolute rounded-[50%]"
          style={{
            width: size * 0.72,
            height: 18,
            top: `calc(50% + ${size / 2 + 20}px)`,
            background: "radial-gradient(ellipse at center, rgb(0 0 0 / 0.75) 0%, rgb(0 0 0 / 0.3) 45%, transparent 72%)",
          }}
        />

        <div className="animate-avatar-float relative" style={{ width: size, height: size }}>
          <motion.div animate={controls} className="relative size-full">
            <span
              aria-hidden
              className="absolute -inset-3 rounded-full"
              style={{ background: `radial-gradient(circle, ${alpha(bg, 45)} 0%, transparent 70%)` }}
            />
            <div
              className="relative size-full overflow-hidden rounded-full"
              style={{
                boxShadow: `0 0 0 1px rgb(255 255 255 / 0.18), 0 18px 50px -12px rgb(0 0 0 / 0.9), 0 0 60px -10px ${alpha(bg, 55)}`,
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- local SVG data URI */}
              <img src={src} alt="" width={size} height={size} draggable={false} decoding="sync" className="block size-full" />
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 rounded-full"
                style={{ background: "linear-gradient(160deg, rgb(255 255 255 / 0.14) 0%, transparent 38%)" }}
              />
            </div>
          </motion.div>
          {!reduced && pulse.n > 0 && pulse.kind !== "tick" && (
            <Burst key={pulse.n} seed={pulse.n} size={size} color={bg} big={pulse.kind === "land"} />
          )}
        </div>
      </div>
    </div>
  );
}
