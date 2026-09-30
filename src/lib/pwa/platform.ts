/**
 * Pure platform detection for the PWA install flow. Everything takes plain
 * values (no `window`) so it can be unit-tested; `usePlatform` feeds it the
 * real navigator.
 */

export type PlatformInput = {
  userAgent: string;
  /** navigator.platform (deprecated but still the reliable iPadOS-as-Mac tell). */
  platform?: string;
  maxTouchPoints?: number;
};

export type Platform = {
  /** iPhone, iPod or iPad (iPadOS 13+ reports itself as a Mac with touch). */
  isIOS: boolean;
  isIPad: boolean;
  /**
   * Real Safari (or a WebKit view that can Add to Home Screen from the Share
   * sheet). False for iOS Chrome/Firefox/Edge/Opera/Google app and in-app
   * browsers (Instagram, Facebook, Line…), which the guide tells to open in Safari.
   */
  isSafari: boolean;
};

export function detectPlatform({ userAgent, platform = "", maxTouchPoints = 0 }: PlatformInput): Platform {
  const ua = userAgent;
  const iPadOSAsMac = platform === "MacIntel" && maxTouchPoints > 1;
  const isIPad = /\biPad\b/.test(ua) || iPadOSAsMac;
  const isIOS = /\b(iPhone|iPod)\b/.test(ua) || isIPad;
  // Everything that runs WebKit on iOS carries "Safari" in the UA, so exclude the known wrappers.
  const wrapped =
    /\b(CriOS|FxiOS|EdgiOS|OPiOS|OPT|GSA|DuckDuckGo|YaBrowser|Instagram|FBAN|FBAV|FB_IAB|Line|MicroMessenger|Snapchat|Twitter|LinkedInApp)\b/.test(
      ua,
    );
  const isSafari = isIOS && !wrapped && (/\bSafari\b/.test(ua) || iPadOSAsMac);
  return { isIOS, isIPad, isSafari };
}

/** Launched from the Home Screen (iOS `navigator.standalone`) or installed as a PWA elsewhere. */
export function isStandaloneDisplay(input: { navigatorStandalone?: boolean; displayModeStandalone?: boolean }): boolean {
  return input.navigatorStandalone === true || input.displayModeStandalone === true;
}

/** Should the login page nudge toward /install? Only iOS Safari, only when not already installed. */
export function shouldOfferInstall(p: Platform, standalone: boolean): boolean {
  return p.isIOS && p.isSafari && !standalone;
}
