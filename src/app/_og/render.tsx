import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { OG_SIZE } from "@/lib/site";

/**
 * Shared renderer for /opengraph-image and /twitter-image (1200x630). No user
 * data: it is the same brand card for everyone, so it is prerendered at build.
 * Fonts are bundled as TTF next to this file (Barlow Condensed and JetBrains
 * Mono, both SIL OFL 1.1; licenses alongside) because ImageResponse can't use
 * the woff2 files next/font emits.
 */

const GREEN = "#2BD67B";
const STRAIN = "#3D9BFF";
const SLEEP = "#8C9BFF";

const GLOWS = [
  { id: "glow-recovery", color: GREEN, opacity: 0.3, cx: 1000, cy: 60, r: 470 },
  { id: "glow-strain", color: STRAIN, opacity: 0.34, cx: 960, cy: 470, r: 520 },
  { id: "glow-sleep", color: SLEEP, opacity: 0.26, cx: 40, cy: 640, r: 480 },
];

const fontDir = path.join(process.cwd(), "src", "app", "_og");

export async function renderOgImage(): Promise<ImageResponse> {
  const [barlow, mono] = await Promise.all([
    readFile(path.join(fontDir, "BarlowCondensed-Bold.ttf")),
    readFile(path.join(fontDir, "JetBrainsMono-Medium.ttf")),
  ]);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          background: "#0A0B0D",
          color: "#FFFFFF",
          fontFamily: "Barlow Condensed",
        }}
      >
        {/* Signal glows: recovery green top-right, strain blue behind the mark, sleep periwinkle bottom-left. */}
        <svg width="1200" height="630" viewBox="0 0 1200 630" style={{ position: "absolute", left: 0, top: 0 }}>
          <defs>
            {GLOWS.map((g) => (
              <radialGradient key={g.id} id={g.id}>
                <stop offset="0" stopColor={g.color} stopOpacity={g.opacity} />
                <stop offset="1" stopColor={g.color} stopOpacity={0} />
              </radialGradient>
            ))}
          </defs>
          {GLOWS.map((g) => (
            <circle key={g.id} cx={g.cx} cy={g.cy} r={g.r} fill={`url(#${g.id})`} />
          ))}
        </svg>
        {/* Hairline frame */}
        <div
          style={{
            position: "absolute",
            top: 28,
            left: 28,
            right: 28,
            bottom: 28,
            display: "flex",
            border: "1px solid rgba(255,255,255,0.10)",
            borderRadius: 26,
          }}
        />

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            padding: "72px 84px",
            flex: 1,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              fontFamily: "JetBrains Mono",
              fontSize: 22,
              letterSpacing: 5,
              color: "#8A9099",
            }}
          >
            <div style={{ width: 12, height: 12, borderRadius: 12, background: GREEN, display: "flex" }} />
            PRIVATE · INVITE ONLY
          </div>

          <div style={{ display: "flex", flexDirection: "column" }}>
            <div
              style={{
                display: "flex",
                fontSize: 232,
                fontWeight: 700,
                lineHeight: 0.82,
                letterSpacing: 4,
                textTransform: "uppercase",
              }}
            >
              HUDDLE
            </div>
            <div style={{ display: "flex", marginTop: 34, fontSize: 46, fontWeight: 700, letterSpacing: 1.5, color: "#C8CCD3" }}>
              Recovery, strain and sleep — together.
            </div>
          </div>
        </div>

        {/* Three-ring mark (same geometry as public/icons/icon.svg) */}
        <div style={{ position: "absolute", right: 92, top: 112, display: "flex" }}>
          <svg width="320" height="320" viewBox="84 84 344 344">
            <circle cx="256" cy="196" r="92" fill="none" stroke={GREEN} strokeWidth="34" />
            <circle cx="196" cy="300" r="92" fill="none" stroke={STRAIN} strokeWidth="34" />
            <circle cx="316" cy="300" r="92" fill="none" stroke={SLEEP} strokeWidth="34" />
          </svg>
        </div>
      </div>
    ),
    {
      ...OG_SIZE,
      fonts: [
        { name: "Barlow Condensed", data: barlow, weight: 700, style: "normal" },
        { name: "JetBrains Mono", data: mono, weight: 500, style: "normal" },
      ],
    },
  );
}
