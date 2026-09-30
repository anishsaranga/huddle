"use client";

import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent } from "react";

const HOLD_MS = 420;
const MOVE_TOLERANCE = 10;

/**
 * Long-press on touch (420 ms, cancelled by scrolling) and right-click /
 * context-menu key on desktop both call `onOpen` with the pressed element.
 * iOS's own callout and text selection are suppressed by the caller's CSS.
 */
export function useLongPress(onOpen: (el: HTMLElement) => void, enabled = true) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  };

  useEffect(() => clear, []);

  if (!enabled) return {};

  return {
    onPointerDown(e: ReactPointerEvent<HTMLElement>) {
      fired.current = false;
      if (e.pointerType === "mouse") return;
      const el = e.currentTarget;
      start.current = { x: e.clientX, y: e.clientY };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        fired.current = true;
        start.current = null;
        timer.current = null;
        navigator.vibrate?.(8);
        onOpen(el);
      }, HOLD_MS);
    },
    onPointerMove(e: ReactPointerEvent<HTMLElement>) {
      const s = start.current;
      if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > MOVE_TOLERANCE) clear();
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onPointerLeave: clear,
    onContextMenu(e: ReactMouseEvent<HTMLElement>) {
      e.preventDefault();
      // A touch long-press also fires contextmenu on some browsers: open once.
      if (fired.current) return;
      clear();
      onOpen(e.currentTarget);
    },
    onClickCapture(e: ReactMouseEvent<HTMLElement>) {
      // The click that ends a long-press must not follow a link or toggle anything.
      if (fired.current) {
        e.preventDefault();
        e.stopPropagation();
        fired.current = false;
      }
    },
  };
}
