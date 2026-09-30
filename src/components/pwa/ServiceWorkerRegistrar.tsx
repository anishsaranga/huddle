"use client";

import { useEffect } from "react";
import { useToast } from "@/components/ui/Toast";

const SHELL_REFRESH_KEY = "huddle-shell-refreshed-at";
const SHELL_REFRESH_EVERY_MS = 12 * 60 * 60 * 1000;
/** Standalone iOS apps stay alive for days, so look for a new worker whenever the app comes back to the foreground. */
const UPDATE_CHECK_MIN_GAP_MS = 60 * 60 * 1000;

/**
 * Registers /sw.js (production only, and only where service workers exist) and
 * shows an "Update available" toast when a new worker is waiting. Renders nothing.
 */
export function ServiceWorkerRegistrar() {
  const { toast } = useToast();

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    let cancelled = false;
    let reloading = false;
    let updateRequested = false;
    let notified = false;
    let lastCheck = Date.now();
    const container = navigator.serviceWorker;

    const announce = (waiting: ServiceWorker) => {
      if (notified) return;
      notified = true;
      toast({
        title: "Update available",
        description: "Tap to refresh.",
        duration: Infinity,
        onSelect: () => {
          updateRequested = true;
          waiting.postMessage({ type: "SKIP_WAITING" });
        },
      });
    };

    // The new worker took over after the user tapped "Update available": reload once so the page and its assets
    // match. (The first install also fires this via clients.claim(); that must not reload the page.)
    const onControllerChange = () => {
      if (!updateRequested || reloading) return;
      reloading = true;
      window.location.reload();
    };
    container.addEventListener("controllerchange", onControllerChange);

    const watch = (reg: ServiceWorkerRegistration) => {
      // A waiting worker is only an "update" when an older one is in control (not on first install).
      if (reg.waiting && container.controller) announce(reg.waiting);
      reg.addEventListener("updatefound", () => {
        const incoming = reg.installing;
        incoming?.addEventListener("statechange", () => {
          if (incoming.state === "installed" && container.controller) announce(incoming);
        });
      });
    };

    let registration: ServiceWorkerRegistration | undefined;
    const onVisible = () => {
      if (document.visibilityState !== "visible" || !registration) return;
      if (Date.now() - lastCheck < UPDATE_CHECK_MIN_GAP_MS) return;
      lastCheck = Date.now();
      registration.update().catch(() => {});
    };

    container
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((reg) => {
        if (cancelled) return;
        registration = reg;
        watch(reg);
        // Keep the offline shell fresh (the worker file rarely changes, but the app's chunks do).
        try {
          const last = Number(localStorage.getItem(SHELL_REFRESH_KEY) || 0);
          if (Date.now() - last > SHELL_REFRESH_EVERY_MS) {
            localStorage.setItem(SHELL_REFRESH_KEY, String(Date.now()));
            container.ready.then((r) => r.active?.postMessage({ type: "REFRESH_SHELL" })).catch(() => {});
          }
        } catch {
          // storage unavailable: skip
        }
      })
      .catch(() => {
        // Registration failing just means no offline support.
      });

    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      container.removeEventListener("controllerchange", onControllerChange);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [toast]);

  return null;
}
