"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { SIGNAL } from "@/lib/ui/colors";

type ConfirmSheetProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  /** Destructive actions get the red signal button. */
  destructive?: boolean;
  pending?: boolean;
};

/** Bottom-sheet confirmation for destructive actions. Thumb-reachable buttons at the bottom. */
export function ConfirmSheet({
  open,
  onClose,
  onConfirm,
  title,
  children,
  confirmLabel,
  destructive = false,
  pending = false,
}: ConfirmSheetProps) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div className="text-[15px] leading-relaxed text-muted">{children}</div>
      <div className="mt-6 space-y-2">
        <Button
          size="lg"
          fullWidth
          variant={destructive ? "signal" : "primary"}
          color={destructive ? SIGNAL.red : undefined}
          loading={pending}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
        <Button size="lg" fullWidth variant="secondary" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
      </div>
    </Sheet>
  );
}
