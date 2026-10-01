import { describe, expect, it } from "vitest";
import { MAX_VH_GAP, VIEWPORT_GAP_SCRIPT, viewportGap } from "@/lib/pwa/viewport-gap";

describe("viewportGap", () => {
  it("is 0 outside standalone mode", () => {
    expect(viewportGap(false, true, 852, 818)).toBe(0);
  });

  it("is 0 in landscape", () => {
    expect(viewportGap(true, false, 852, 818)).toBe(0);
  });

  it("is the shortfall in standalone portrait (iOS 26 bug: 852 screen, 818 containing block)", () => {
    expect(viewportGap(true, true, 852, 818)).toBe(34);
  });

  it("is 0 when the containing block fills the screen (no bug)", () => {
    expect(viewportGap(true, true, 852, 852)).toBe(0);
  });

  it("is 0 when the containing block is taller than the screen", () => {
    expect(viewportGap(true, true, 852, 860)).toBe(0);
  });

  it("rounds fractional measurements", () => {
    expect(viewportGap(true, true, 852, 817.6)).toBe(34);
  });

  it(`keeps ${MAX_VH_GAP}px, and treats anything larger as something else (keyboard, split view): 0`, () => {
    expect(viewportGap(true, true, 852, 852 - MAX_VH_GAP)).toBe(MAX_VH_GAP);
    expect(viewportGap(true, true, 852, 852 - MAX_VH_GAP - 1)).toBe(0);
    expect(viewportGap(true, true, 852, 500)).toBe(0);
  });

  it("is 0 for garbage input", () => {
    expect(viewportGap(true, true, Number.NaN, 818)).toBe(0);
  });
});

/* ---------------- The inline script ---------------- */

type Env = {
  navigatorStandalone?: boolean;
  displayModeStandalone?: boolean;
  portrait?: boolean;
  userAgent?: string;
  screenHeight?: number;
  probeHeight?: number;
  /** Make getBoundingClientRect throw. */
  explode?: boolean;
};

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";
const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";

/** Run the script against minimal window/document/navigator/screen stubs. */
function runScript(initial: Env) {
  const env: Env = { userAgent: IPHONE_UA, screenHeight: 852, probeHeight: 818, portrait: true, ...initial };
  const props = new Map<string, string>();
  const children = new Set<unknown>();
  const winListeners = new Map<string, () => void>();
  const docListeners = new Map<string, () => void>();
  const doc = {
    visibilityState: "visible",
    documentElement: {
      style: { setProperty: (k: string, v: string) => props.set(k, v) },
      appendChild: (c: unknown) => children.add(c),
      removeChild: (c: unknown) => children.delete(c),
    },
    createElement: () => ({
      style: { cssText: "" },
      setAttribute: () => {},
      getBoundingClientRect: () => {
        if (env.explode) throw new Error("boom");
        return { height: env.probeHeight };
      },
    }),
    addEventListener: (t: string, f: () => void) => docListeners.set(t, f),
  };
  const win = {
    matchMedia: (q: string) => ({
      matches:
        q === "(display-mode: standalone)" ? !!env.displayModeStandalone : q === "(orientation: portrait)" ? !!env.portrait : false,
    }),
    addEventListener: (t: string, f: () => void) => winListeners.set(t, f),
  };
  const nav = {
    get standalone() {
      return env.navigatorStandalone;
    },
    get userAgent() {
      return env.userAgent;
    },
  };
  const scr = {
    get height() {
      return env.screenHeight;
    },
  };
  new Function("window", "document", "navigator", "screen", VIEWPORT_GAP_SCRIPT)(win, doc, nav, scr);
  return {
    gap: () => props.get("--vh-gap"),
    probeAttached: () => children.size > 0,
    set: (patch: Env) => Object.assign(env, patch),
    fire: (type: string) => (winListeners.get(type) ?? docListeners.get(type))?.(),
    setHidden: (hidden: boolean) => (doc.visibilityState = hidden ? "hidden" : "visible"),
  };
}

describe("VIEWPORT_GAP_SCRIPT", () => {
  const samples: [Env, number][] = [
    [{ navigatorStandalone: true, screenHeight: 852, probeHeight: 818 }, 34],
    [{ navigatorStandalone: true, screenHeight: 932, probeHeight: 898 }, 34],
    [{ navigatorStandalone: true, screenHeight: 852, probeHeight: 852 }, 0],
    [{ navigatorStandalone: true, screenHeight: 852, probeHeight: 870 }, 0],
    [{ navigatorStandalone: true, screenHeight: 852, probeHeight: 852 - MAX_VH_GAP }, MAX_VH_GAP],
    [{ navigatorStandalone: true, screenHeight: 852, probeHeight: 700 }, 0],
    [{ navigatorStandalone: true, screenHeight: 852, probeHeight: 817.6 }, 34],
    [{ navigatorStandalone: true, portrait: false, screenHeight: 852, probeHeight: 393 }, 0],
    [{ displayModeStandalone: true, screenHeight: 852, probeHeight: 818 }, 34],
  ];

  it.each(samples)("agrees with viewportGap for %o", (env, expected) => {
    const s = runScript(env);
    const pure = viewportGap(true, env.portrait ?? true, env.screenHeight!, env.probeHeight!);
    expect(pure).toBe(expected);
    expect(s.gap()).toBe(`${expected}px`);
    expect(s.probeAttached()).toBe(false);
  });

  it("leaves --vh-gap unset in a browser tab, so the CSS fallback (0px) and any override apply", () => {
    expect(runScript({ screenHeight: 852, probeHeight: 818 }).gap()).toBeUndefined();
  });

  it("ignores display-mode: standalone outside iOS (Android/desktop PWAs)", () => {
    expect(runScript({ displayModeStandalone: true, userAgent: ANDROID_UA, probeHeight: 818 }).gap()).toBeUndefined();
  });

  it("re-measures on resize, orientationchange, pageshow and visibilitychange (when visible)", () => {
    const s = runScript({ navigatorStandalone: true, probeHeight: 818 });
    expect(s.gap()).toBe("34px");
    s.set({ portrait: false });
    s.fire("orientationchange");
    expect(s.gap()).toBe("0px");
    s.set({ portrait: true });
    s.fire("resize");
    expect(s.gap()).toBe("34px");
    s.set({ probeHeight: 852 });
    s.fire("pageshow");
    expect(s.gap()).toBe("0px");
    s.set({ probeHeight: 818 });
    s.setHidden(true);
    s.fire("visibilitychange");
    expect(s.gap()).toBe("0px");
    s.setHidden(false);
    s.fire("visibilitychange");
    expect(s.gap()).toBe("34px");
  });

  it("never throws", () => {
    expect(() => runScript({ navigatorStandalone: true, explode: true })).not.toThrow();
    expect(() => new Function("window", "document", "navigator", "screen", VIEWPORT_GAP_SCRIPT)({}, {}, {}, {})).not.toThrow();
  });
});
