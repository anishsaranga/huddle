import { describe, expect, it } from "vitest";
import { detectPlatform, isStandaloneDisplay, shouldOfferInstall } from "@/lib/pwa/platform";
import { SPLASH_SCREENS, splashFile, splashMedia, startupImages } from "@/lib/pwa/splash";

const UA = {
  iphoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  iphoneChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.153 Mobile/15E148 Safari/604.1",
  iphoneFirefox:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/128.0 Mobile/15E148 Safari/605.1.15",
  iphoneInstagram:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0.0.20.113 (iPhone15,2)",
  iphoneHomeScreen:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
  ipadOsSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  macSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
  desktopChrome:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
};

describe("detectPlatform", () => {
  it("recognizes iPhone Safari", () => {
    expect(detectPlatform({ userAgent: UA.iphoneSafari })).toEqual({ isIOS: true, isIPad: false, isSafari: true });
  });

  it("treats iOS Chrome, Firefox and in-app browsers as iOS but not Safari", () => {
    for (const ua of [UA.iphoneChrome, UA.iphoneFirefox, UA.iphoneInstagram]) {
      const p = detectPlatform({ userAgent: ua });
      expect(p.isIOS, ua).toBe(true);
      expect(p.isSafari, ua).toBe(false);
    }
  });

  it("a Home Screen launch (no Safari token) is iOS", () => {
    expect(detectPlatform({ userAgent: UA.iphoneHomeScreen }).isIOS).toBe(true);
  });

  it("detects iPadOS, which reports itself as a touch Mac", () => {
    const p = detectPlatform({ userAgent: UA.ipadOsSafari, platform: "MacIntel", maxTouchPoints: 5 });
    expect(p).toEqual({ isIOS: true, isIPad: true, isSafari: true });
  });

  it("does not mistake a real Mac (no touch) for iOS", () => {
    const p = detectPlatform({ userAgent: UA.macSafari, platform: "MacIntel", maxTouchPoints: 0 });
    expect(p.isIOS).toBe(false);
  });

  it("Android and desktop are not iOS", () => {
    expect(detectPlatform({ userAgent: UA.androidChrome }).isIOS).toBe(false);
    expect(detectPlatform({ userAgent: UA.desktopChrome }).isIOS).toBe(false);
  });
});

describe("isStandaloneDisplay / shouldOfferInstall", () => {
  it("is standalone when either signal says so", () => {
    expect(isStandaloneDisplay({ navigatorStandalone: true })).toBe(true);
    expect(isStandaloneDisplay({ displayModeStandalone: true })).toBe(true);
    expect(isStandaloneDisplay({ navigatorStandalone: false, displayModeStandalone: false })).toBe(false);
    expect(isStandaloneDisplay({})).toBe(false);
  });

  it("offers the install link only to iOS Safari outside the installed app", () => {
    const safari = detectPlatform({ userAgent: UA.iphoneSafari });
    const chrome = detectPlatform({ userAgent: UA.iphoneChrome });
    const desktop = detectPlatform({ userAgent: UA.desktopChrome });
    expect(shouldOfferInstall(safari, false)).toBe(true);
    expect(shouldOfferInstall(safari, true)).toBe(false);
    expect(shouldOfferInstall(chrome, false)).toBe(false);
    expect(shouldOfferInstall(desktop, false)).toBe(false);
  });
});

describe("splash screens", () => {
  it("covers the twelve portrait iPhone sizes, each with a distinct media query", () => {
    expect(SPLASH_SCREENS).toHaveLength(12);
    expect(new Set(startupImages.map((s) => s.media)).size).toBe(12);
    expect(new Set(startupImages.map((s) => s.url)).size).toBe(12);
  });

  it("pixel size = CSS size x pixel ratio", () => {
    for (const s of SPLASH_SCREENS) {
      expect(s.width, s.devices).toBe(s.cssWidth * s.ratio);
      expect(s.height, s.devices).toBe(s.cssHeight * s.ratio);
    }
  });

  it("builds file names and media queries", () => {
    const s = SPLASH_SCREENS.find((x) => x.width === 1179)!;
    expect(splashFile(s)).toBe("/splash/splash-1179x2556.png");
    expect(splashMedia(s)).toBe(
      "(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
    );
  });
});
