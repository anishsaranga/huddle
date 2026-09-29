"use client";

import { useCallback, useState } from "react";

/**
 * State for a confirmation sheet. `target` outlives `open` so the sheet's
 * content doesn't blank out while it animates closed.
 */
export function useConfirm<T>() {
  const [target, setTarget] = useState<T | null>(null);
  const [open, setOpen] = useState(false);

  const ask = useCallback((t: T) => {
    setTarget(t);
    setOpen(true);
  }, []);
  const close = useCallback(() => setOpen(false), []);

  return { target, open, ask, close };
}
