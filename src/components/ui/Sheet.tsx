"use client";

import { AnimatePresence, motion, useDragControls } from "motion/react";
import { useEffect, useId, useRef, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { spring } from "@/lib/ui/motion";

type SheetProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  className?: string;
};

const subscribe = () => () => {};

/**
 * Bottom sheet. Drag the grabber/header down to dismiss (distance or flick
 * velocity), tap the backdrop, or press Escape. Content scrolls inside;
 * bottom padding respects the home indicator.
 */
export function Sheet({ open, onClose, title, children, className = "" }: SheetProps) {
  const mounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const controls = useDragControls();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[60]">
          <motion.div
            aria-hidden
            className="absolute inset-0 bg-black/60"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            onClick={onClose}
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? titleId : undefined}
            tabIndex={-1}
            className={`surface surface-elevated absolute inset-x-0 bottom-0 mx-auto flex max-h-[88dvh] max-w-md flex-col rounded-b-none rounded-t-[26px] outline-none ${className}`}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={spring.sheet}
            drag="y"
            dragListener={false}
            dragControls={controls}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0.04, bottom: 0.9 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 110 || info.velocity.y > 600) onClose();
            }}
          >
            <div
              className="nav-chrome shrink-0 touch-none px-5 pb-2 pt-2.5"
              onPointerDown={(e) => controls.start(e)}
            >
              <div className="mx-auto h-[5px] w-10 rounded-full bg-white/20" />
              {title && (
                <h2
                  id={titleId}
                  className="mt-4 font-display text-[24px] font-bold uppercase leading-none tracking-wide"
                >
                  {title}
                </h2>
              )}
            </div>
            <div
              className="scroll-area px-5 pt-2"
              style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 20px)" }}
            >
              {children}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
