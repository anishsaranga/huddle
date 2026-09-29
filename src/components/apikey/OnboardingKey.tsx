"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { ensureOnboardingKeyAction, regenerateKeyAction, type KeyStatusDTO } from "@/lib/apikey-actions";
import { KeyReveal } from "./KeyReveal";

type Loaded = { key: string | null; status: KeyStatusDTO };
type State = { phase: "loading" } | { phase: "error"; error: string } | ({ phase: "ready" } & Loaded);

/*
 * One request per user per page load: the key is created once and its
 * plaintext kept in memory, so React Strict Mode's double effects and going
 * Back/forward through the stepper never create a second key or lose the
 * one being shown.
 */
const inflight = new Map<string, Promise<State>>();

function load(userId: string, fresh = false): Promise<State> {
  let p = fresh ? undefined : inflight.get(userId);
  if (!p) {
    p = ensureOnboardingKeyAction()
      .then((r): State => (r.ok ? { phase: "ready", key: r.key, status: r.status } : { phase: "error", error: r.error }))
      .catch((): State => ({ phase: "error", error: "Couldn't reach the server. Try again." }));
    p.then((s) => {
      if (s.phase === "error") inflight.delete(userId);
    });
    inflight.set(userId, p);
  }
  return p;
}

/**
 * Final onboarding step: creates the user's first sync key (if they have
 * none) and reveals it once. If a key already exists (e.g. the page was
 * reloaded), offers to replace it, since the old one can't be shown again.
 */
export function OnboardingKey({ userId, ingestUrl }: { userId: string; ingestUrl: string }) {
  const [state, setState] = useState<State>({ phase: "loading" });
  const [replacing, setReplacing] = useState(false);

  useEffect(() => {
    let alive = true;
    load(userId).then((s) => alive && setState(s));
    return () => {
      alive = false;
    };
  }, [userId]);

  const retry = () => {
    setState({ phase: "loading" });
    load(userId, true).then(setState);
  };

  const replace = async () => {
    setReplacing(true);
    try {
      const r = await regenerateKeyAction();
      const next: State = r.ok ? { phase: "ready", key: r.key, status: r.status } : { phase: "error", error: r.error };
      if (r.ok) inflight.set(userId, Promise.resolve(next));
      setState(next);
    } catch {
      setState({ phase: "error", error: "Couldn't reach the server. Try again." });
    } finally {
      setReplacing(false);
    }
  };

  if (state.phase === "loading") {
    return (
      <div aria-busy="true" aria-label="Creating your sync key">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="mt-3 h-[76px] w-full" rounded="lg" />
        <Skeleton className="mt-3 h-[52px] w-full" rounded="full" />
      </div>
    );
  }

  if (state.phase === "error") {
    return (
      <div className="rounded-xl px-4 py-3.5 text-center shadow-[inset_0_0_0_1px_var(--hairline-strong)]">
        <p role="alert" className="text-[14px] leading-snug text-recovery-red">
          {state.error}
        </p>
        <Button variant="secondary" size="sm" className="mt-3" onClick={retry}>
          Try again
        </Button>
      </div>
    );
  }

  if (state.key) return <KeyReveal apiKey={state.key} ingestUrl={ingestUrl} />;

  return (
    <div className="rounded-xl bg-card-sunken px-4 py-4 shadow-[inset_0_1px_2px_rgb(0_0_0/0.5),inset_0_0_0_1px_var(--hairline-strong)]">
      <p className="telemetry">{"// Your sync key"}</p>
      <p className="mt-2 font-mono text-[15px] text-text-2">
        {state.status.prefixHint}
        <span className="text-dim">{"••••••••"}</span>
      </p>
      <p className="mt-2 text-[13px] leading-snug text-muted">
        You already have a key. For your security it can&rsquo;t be shown again. Make a new one if you didn&rsquo;t save it.
      </p>
      <Button variant="secondary" size="md" fullWidth className="mt-3" loading={replacing} onClick={replace}>
        Make a new key
      </Button>
    </div>
  );
}
