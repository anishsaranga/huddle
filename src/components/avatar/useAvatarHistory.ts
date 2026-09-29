"use client";

import { useCallback, useRef, useState } from "react";
import { configKey, type AvatarConfig } from "@/lib/avatar/key";

export type AvatarHistory = {
  /** Apply a change and record the previous value. */
  commit: (next: AvatarConfig, opts?: { coalesce?: string }) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Forget all history (e.g. after saving). */
  clear: () => void;
};

const COALESCE_MS = 1200;

/**
 * Undo/redo for a controlled avatar config. Pass the current `value` and the
 * parent's `onChange`; every `commit` pushes the old value onto the undo
 * stack. Rapid commits with the same `coalesce` key (e.g. dragging a color
 * picker) collapse into one entry.
 */
export function useAvatarHistory(
  value: AvatarConfig,
  onChange: (next: AvatarConfig) => void,
  limit = 60,
): AvatarHistory {
  const [past, setPast] = useState<AvatarConfig[]>([]);
  const [future, setFuture] = useState<AvatarConfig[]>([]);
  const last = useRef<{ key: string; at: number } | null>(null);

  const commit = useCallback(
    (next: AvatarConfig, opts?: { coalesce?: string }) => {
      if (configKey(next) === configKey(value)) return;
      const now = Date.now();
      const coalescing =
        opts?.coalesce !== undefined &&
        last.current?.key === opts.coalesce &&
        now - last.current.at < COALESCE_MS;
      if (!coalescing) setPast((p) => [...p.slice(-(limit - 1)), value]);
      last.current = opts?.coalesce !== undefined ? { key: opts.coalesce, at: now } : null;
      setFuture([]);
      onChange(next);
    },
    [value, onChange, limit],
  );

  const undo = useCallback(() => {
    if (past.length === 0) return;
    const prev = past[past.length - 1];
    setPast(past.slice(0, -1));
    setFuture((f) => [value, ...f]);
    last.current = null;
    onChange(prev);
  }, [past, value, onChange]);

  const redo = useCallback(() => {
    if (future.length === 0) return;
    const [next, ...rest] = future;
    setFuture(rest);
    setPast((p) => [...p, value]);
    last.current = null;
    onChange(next);
  }, [future, value, onChange]);

  const clear = useCallback(() => {
    setPast([]);
    setFuture([]);
    last.current = null;
  }, []);

  return { commit, undo, redo, canUndo: past.length > 0, canRedo: future.length > 0, clear };
}
