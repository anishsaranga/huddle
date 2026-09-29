"use client";

import { useCallback, useTransition } from "react";
import { useToast } from "@/components/ui/Toast";
import type { ActionResult } from "@/lib/admin/db";

type RunOptions<T extends object> = {
  /** Runs synchronously inside the transition, before the server call (set optimistic state here). */
  optimistic?: () => void;
  /** Runs after a successful result. */
  onSuccess?: (result: Extract<ActionResult<T>, { ok: true }>) => void;
  /** Runs after a failed result (server-side rejection or thrown error). */
  onError?: (message: string) => void;
  /** Toast title on success; defaults to the server's message. Pass false for none. */
  successTitle?: string | false;
};

/**
 * Runs a server action in a transition with a pending flag, and toasts the
 * outcome. Optimistic state set via `optimistic` reverts automatically if the
 * action fails (React drops it when the transition ends).
 */
export function useAdminAction() {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const run = useCallback(
    <T extends object>(fn: () => Promise<ActionResult<T>>, opts: RunOptions<T> = {}) => {
      startTransition(async () => {
        opts.optimistic?.();
        let result: ActionResult<T>;
        try {
          result = await fn();
        } catch {
          result = { ok: false, error: "Couldn't reach the server. Try again." };
        }
        if (result.ok) {
          const title = opts.successTitle ?? result.message;
          if (title) toast({ title, tone: "success" });
          opts.onSuccess?.(result);
        } else {
          toast({ title: "Couldn't do that", description: result.error, tone: "error", duration: 4500 });
          opts.onError?.(result.error);
        }
      });
    },
    [toast],
  );

  return { run, pending };
}
