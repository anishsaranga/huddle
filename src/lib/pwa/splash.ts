/**
 * iPhone launch-screen sizes for `apple-touch-startup-image`. iOS picks the
 * image whose media query matches the device exactly, so each entry pairs the
 * PNG's pixel size with the device's CSS size and pixel ratio.
 * `scripts/gen-splash.ts` renders the PNGs from this list into public/splash/.
 */
export type SplashScreen = {
  /** PNG pixel size (portrait). */
  width: number;
  height: number;
  /** Device size in CSS px and its pixel ratio. */
  cssWidth: number;
  cssHeight: number;
  ratio: 2 | 3;
  /** Devices, for humans. */
  devices: string;
};

export const SPLASH_SCREENS: readonly SplashScreen[] = [
  { width: 1320, height: 2868, cssWidth: 440, cssHeight: 956, ratio: 3, devices: "iPhone 16 Pro Max" },
  { width: 1206, height: 2622, cssWidth: 402, cssHeight: 874, ratio: 3, devices: "iPhone 16 Pro" },
  { width: 1290, height: 2796, cssWidth: 430, cssHeight: 932, ratio: 3, devices: "iPhone 14/15 Pro Max, 15/16 Plus" },
  { width: 1179, height: 2556, cssWidth: 393, cssHeight: 852, ratio: 3, devices: "iPhone 14 Pro, 15, 15 Pro, 16" },
  { width: 1284, height: 2778, cssWidth: 428, cssHeight: 926, ratio: 3, devices: "iPhone 12/13 Pro Max, 14 Plus" },
  { width: 1170, height: 2532, cssWidth: 390, cssHeight: 844, ratio: 3, devices: "iPhone 12/13/14, 12/13 Pro" },
  { width: 1125, height: 2436, cssWidth: 375, cssHeight: 812, ratio: 3, devices: "iPhone X, XS, 11 Pro, 12/13 mini" },
  { width: 1242, height: 2688, cssWidth: 414, cssHeight: 896, ratio: 3, devices: "iPhone XS Max, 11 Pro Max" },
  { width: 828, height: 1792, cssWidth: 414, cssHeight: 896, ratio: 2, devices: "iPhone XR, 11" },
  { width: 1242, height: 2208, cssWidth: 414, cssHeight: 736, ratio: 3, devices: "iPhone 6/7/8 Plus" },
  { width: 750, height: 1334, cssWidth: 375, cssHeight: 667, ratio: 2, devices: "iPhone SE 2/3, 6/7/8" },
  { width: 640, height: 1136, cssWidth: 320, cssHeight: 568, ratio: 2, devices: "iPhone SE 1, 5s" },
];

export const splashFile = (s: Pick<SplashScreen, "width" | "height">): string =>
  `/splash/splash-${s.width}x${s.height}.png`;

export const splashMedia = (s: SplashScreen): string =>
  `(device-width: ${s.cssWidth}px) and (device-height: ${s.cssHeight}px) and (-webkit-device-pixel-ratio: ${s.ratio}) and (orientation: portrait)`;

/** Shape of Next's `appleWebApp.startupImage`. */
export const startupImages = SPLASH_SCREENS.map((s) => ({ url: splashFile(s), media: splashMedia(s) }));
