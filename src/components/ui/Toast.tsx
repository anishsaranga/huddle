"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { SIGNAL } from "@/lib/ui/colors";
import { spring } from "@/lib/ui/motion";

export type ToastTone = "neutral" | "success" | "warning" | "error";

export type ToastOptions = {
  title: string;
  description?: string;
  tone?: ToastTone;
  /** Auto-dismiss after ms. Default 3200. */
  duration?: number;
};

type ToastItem = Required<Omit<ToastOptions, "description">> & {
  id: number;
  description?: string;
};

type ToastApi = {
  toast: (opts: ToastOptions) => number;
  dismiss: (id: number) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

const toneColor: Record<ToastTone, string> = {
  neutral: "var(--text-2)",
  success: SIGNAL.green,
  warning: SIGNAL.yellow,
  error: SIGNAL.red,
};

const MAX_VISIBLE = 3;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setItems((list) => list.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((opts: ToastOptions) => {
    const id = nextId.current++;
    setItems((list) =>
      [
        ...list,
        { id, tone: "neutral", duration: 3200, ...opts } as ToastItem,
      ].slice(-MAX_VISIBLE),
    );
    return id;
  }, []);

  const api = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 top-0 z-[70] flex flex-col items-center gap-2 px-4 pt-safe"
      >
        <div className="h-2" />
        <AnimatePresence initial={false}>
          {items.map((t) => (
            <ToastView key={t.id} item={t} onDismiss={dismiss} />
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

function ToastView({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }) {
  useEffect(() => {
    const t = window.setTimeout(() => onDismiss(item.id), item.duration);
    return () => window.clearTimeout(t);
  }, [item.id, item.duration, onDismiss]);

  const color = toneColor[item.tone];

  return (
    <motion.div
      layout
      role={item.tone === "error" ? "alert" : "status"}
      initial={{ opacity: 0, y: -48, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -32, scale: 0.96, transition: { duration: 0.18 } }}
      transition={spring.sheet}
      drag="y"
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={{ top: 0.6, bottom: 0.1 }}
      onDragEnd={(_, info) => {
        if (info.offset.y < -24 || info.velocity.y < -300) onDismiss(item.id);
      }}
      onClick={() => onDismiss(item.id)}
      className="surface surface-elevated pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-2xl px-4 py-3"
    >
      <span
        aria-hidden
        className="mt-[5px] size-2 shrink-0 rounded-full"
        style={{ background: color, boxShadow: `0 0 10px ${color}` }}
      />
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-semibold leading-tight text-text">{item.title}</p>
        {item.description && (
          <p className="mt-0.5 text-[13px] leading-snug text-muted">{item.description}</p>
        )}
      </div>
    </motion.div>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
