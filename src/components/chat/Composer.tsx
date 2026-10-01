"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useToast } from "@/components/ui/Toast";
import { codePointLength, MAX_MESSAGE_CHARS, normalizeBody } from "@/lib/chat/validate";
import { spring } from "@/lib/ui/motion";

export type ComposerMetrics = {
  /** Composer height, px. */
  height: number;
  /** Distance from the layout viewport's bottom edge to the composer's bottom edge, px. */
  bottom: number;
};

type ComposerProps = {
  visible: boolean;
  placeholder: string;
  onSend: (body: string) => void;
  onMetrics: (m: ComposerMetrics) => void;
};

const MAX_LINES = 5;
const LINE_PX = 22;
const PAD_Y = 9;
const COUNTER_FROM = MAX_MESSAGE_CHARS - 100;

const subscribe = () => () => {};

/**
 * Height of the on-screen keyboard over the layout viewport (iOS doesn't
 * resize the layout viewport; the visual viewport shrinks and may pan).
 * 0 when closed.
 */
function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const v = window.innerHeight - vv.height - vv.offsetTop;
      setInset(v > 60 ? Math.round(v) : 0);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);
  return inset;
}

/**
 * The message bar: pinned above the tab bar, or above the keyboard while it's
 * open (visualViewport), safe-area aware. 16px auto-growing textarea (up to
 * 5 lines). Enter sends on devices with a fine pointer; on touch devices
 * Return is a newline and the button sends.
 */
export function Composer({ visible, placeholder, onSend, onMetrics }: ComposerProps) {
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  const { toast } = useToast();
  const [text, setText] = useState("");
  const inset = useKeyboardInset();
  const boxRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const metricsRef = useRef(onMetrics);
  useLayoutEffect(() => {
    metricsRef.current = onMetrics;
  });

  const canSend = text.trim().length > 0;
  const count = codePointLength(text);

  // Auto-grow: reset to one line, then fit the content up to MAX_LINES.
  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const max = LINE_PX * MAX_LINES + PAD_Y * 2;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
  }, [text, visible]);

  // Report size/position so the list can pad itself above the bar.
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el || !visible) return;
    const report = () => {
      const bottom = parseFloat(getComputedStyle(el).bottom) || 0;
      metricsRef.current({ height: el.offsetHeight, bottom });
    };
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [visible, inset, mounted]);

  // Leaving the tab closes the keyboard.
  useEffect(() => {
    if (!visible && document.activeElement === areaRef.current) areaRef.current?.blur();
  }, [visible]);

  const submit = () => {
    const r = normalizeBody(text);
    if (!r.ok) {
      if (r.code !== "empty") toast({ title: "Can't send that", description: r.message, tone: "warning" });
      return;
    }
    onSend(r.body);
    setText("");
  };

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {visible && (
        <motion.div
          ref={boxRef}
          key="composer"
          className="px-safe fixed inset-x-0 z-40"
          // Keyboard closed: right on top of the tab bar, which sits at bottom: -var(--vh-gap)
          // (see bottom-app in globals.css), so subtract the gap too. Keyboard open: `inset`
          // is measured against the layout viewport (innerHeight vs visualViewport), the same
          // box this fixed element's `bottom` resolves against, so it already lands on the
          // keyboard's top edge and subtracting the gap would tuck the bar under the keyboard.
          style={{
            bottom: inset > 0 ? inset : "calc(var(--tabbar-h) + env(safe-area-inset-bottom) - var(--vh-gap, 0px))",
          }}
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24, transition: { duration: 0.16 } }}
          transition={spring.sheet}
        >
          {/* Messages fade out under the bar. */}
          <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-6 h-6 bg-[linear-gradient(180deg,transparent,rgb(10_11_13/0.85))]" />
          <div className="mx-auto w-full max-w-md bg-[rgba(10,11,13,0.86)] px-3 pb-2 pt-1.5 backdrop-blur-xl backdrop-saturate-150">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
              className="flex items-end gap-2 rounded-[24px] bg-card-sunken py-1 pl-4 pr-1 shadow-[inset_0_0_0_1px_var(--hairline-strong),inset_0_1px_2px_rgb(0_0_0/0.5)] transition-shadow focus-within:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.26),inset_0_1px_2px_rgb(0_0_0/0.5)]"
            >
              <label htmlFor="chat-composer" className="sr-only">
                Message
              </label>
              <textarea
                id="chat-composer"
                ref={areaRef}
                rows={1}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" || e.shiftKey || e.altKey || e.nativeEvent.isComposing) return;
                  if (window.matchMedia("(pointer: coarse)").matches) return; // newline on touch keyboards
                  e.preventDefault();
                  submit();
                }}
                placeholder={placeholder}
                enterKeyHint="enter"
                autoComplete="off"
                autoCorrect="on"
                spellCheck
                maxLength={MAX_MESSAGE_CHARS * 2}
                className="block min-w-0 flex-1 resize-none bg-transparent text-[16px] text-text outline-none placeholder:text-dim focus-visible:outline-none"
                // The capsule shows focus (focus-within); the global :focus-visible outline is unlayered, so override inline.
                style={{ lineHeight: `${LINE_PX}px`, paddingTop: PAD_Y, paddingBottom: PAD_Y, outline: "none" }}
              />
              {count > COUNTER_FROM && (
                <span
                  className={`num mb-3 shrink-0 font-mono text-[11px] ${count > MAX_MESSAGE_CHARS ? "text-recovery-red" : "text-muted"}`}
                  aria-live="polite"
                >
                  {MAX_MESSAGE_CHARS - count}
                </span>
              )}
              <motion.button
                type="submit"
                aria-label="Send"
                disabled={!canSend}
                // Keep the textarea focused (and the keyboard up) when tapping Send.
                onPointerDown={(e) => e.preventDefault()}
                onMouseDown={(e) => e.preventDefault()}
                animate={{ scale: canSend ? 1 : 0.86, opacity: canSend ? 1 : 0.5 }}
                whileTap={canSend ? { scale: 0.86 } : undefined}
                transition={spring.bouncy}
                className={`mb-[3px] grid size-[36px] shrink-0 place-items-center rounded-full transition-colors duration-200 ${
                  canSend ? "bg-white text-bg shadow-[0_0_14px_rgb(255_255_255/0.25)]" : "bg-white/[0.08] text-muted"
                }`}
              >
                <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" />
                </svg>
              </motion.button>
            </form>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
