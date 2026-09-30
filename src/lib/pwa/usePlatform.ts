"use client";

import { useSyncExternalStore } from "react";
import { detectPlatform, isStandaloneDisplay, type Platform } from "./platform";

export type ClientPlatform = Platform & { standalone: boolean };

let cached: ClientPlatform | undefined;

function read(): ClientPlatform {
  if (!cached) {
    const nav = navigator as Navigator & { standalone?: boolean };
    cached = {
      ...detectPlatform({
        userAgent: nav.userAgent,
        platform: nav.platform,
        maxTouchPoints: nav.maxTouchPoints,
      }),
      standalone: isStandaloneDisplay({
        navigatorStandalone: nav.standalone,
        displayModeStandalone: window.matchMedia?.("(display-mode: standalone)").matches,
      }),
    };
  }
  return cached;
}

const subscribe = () => () => {};

/** The visitor's platform, or null during SSR and the hydration pass (so server and client markup match). */
export function usePlatform(): ClientPlatform | null {
  return useSyncExternalStore(subscribe, read, () => null);
}
