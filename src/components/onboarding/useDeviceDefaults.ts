"use client";

import { useSyncExternalStore } from "react";
import type { Units } from "@/db/schema";
import { runtimeTimezone } from "@/lib/admin/timezones";

export type DeviceDefaults = { timezone: string; units: Units };

const SERVER_DEFAULTS: DeviceDefaults = { timezone: "UTC", units: "metric" };

/** Locales that mostly use imperial units. */
const IMPERIAL_LOCALES = /^(en-US|en-LR|my)\b/i;

let cached: DeviceDefaults | undefined;
function readDevice(): DeviceDefaults {
  if (!cached) {
    const lang = typeof navigator !== "undefined" ? navigator.language : "";
    cached = { timezone: runtimeTimezone(), units: IMPERIAL_LOCALES.test(lang) ? "imperial" : "metric" };
  }
  return cached;
}

const subscribe = () => () => {};

/**
 * Device-detected timezone and unit system. Server render and hydration see
 * UTC/metric; the real values arrive right after hydration (no effect, no
 * mismatch warning).
 */
export function useDeviceDefaults(): DeviceDefaults {
  return useSyncExternalStore(subscribe, readDevice, () => SERVER_DEFAULTS);
}
