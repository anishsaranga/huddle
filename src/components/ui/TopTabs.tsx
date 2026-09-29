"use client";

import { animate, motion, useMotionValue, useMotionValueEvent, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { spring } from "@/lib/ui/motion";

export type TopTab = { id: string; label: string; content: ReactNode };

type TopTabsProps = {
  tabs: TopTab[];
  defaultIndex?: number;
  onChange?: (index: number) => void;
  className?: string;
  /** Tabs share the strip's width (tighter padding) instead of scrolling; for a handful of short labels. */
  fill?: boolean;
};

/** Letter-spacing leaves trailing space after the last glyph; trim it off the underline. */
const TRAILING_TRACK = 1.5;

/**
 * Scrollable tab strip over swipeable panels.
 *
 * Panels sit on a transform-driven track (motion drag, x-axis, direction
 * locked so vertical page scroll stays native). Position is always derived
 * from `index × width`, so resizes, full-page captures or focus changes can't
 * leave the track between panels. The underline is linked to the track's x:
 * it interpolates position and width between labels while dragging.
 */
export function TopTabs({ tabs, defaultIndex = 0, onChange, className = "", fill = false }: TopTabsProps) {
  const baseId = useId();
  const reduced = useReducedMotion();
  const stripRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  // The underline spans the label only (measured from the label span, whatever the padding).
  const labelRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const panelRefs = useRef<(HTMLElement | null)[]>([]);
  const [heights, setHeights] = useState<number[]>([]);
  const metrics = useRef<{ left: number; width: number }[]>([]);
  const widthRef = useRef(0);
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState(defaultIndex);
  const activeRef = useRef(defaultIndex);

  const trackX = useMotionValue(0);
  const lineX = useMotionValue(0);
  const lineScale = useMotionValue(0);

  /** Place the underline at a fractional tab position (e.g. 1.4 = 40% from tab 1 to 2). */
  const placeLine = useCallback(
    (pos: number) => {
      const m = metrics.current;
      if (m.length === 0) return;
      const p = Math.min(Math.max(pos, 0), m.length - 1);
      const i = Math.floor(p);
      const t = p - i;
      const a = m[i];
      const b = m[Math.min(i + 1, m.length - 1)];
      lineX.set(a.left + (b.left - a.left) * t);
      lineScale.set(a.width + (b.width - a.width) * t);
    },
    [lineX, lineScale],
  );

  useMotionValueEvent(trackX, "change", (v) => {
    if (widthRef.current > 0) placeLine(-v / widthRef.current);
  });

  // Measure panel width + label positions; re-pin the track to the active panel.
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const measure = () => {
      const w = viewport.clientWidth;
      widthRef.current = w;
      setWidth(w);
      metrics.current = tabRefs.current.map((el, i) => {
        const label = labelRefs.current[i];
        return el && label
          ? {
              left: el.offsetLeft + label.offsetLeft,
              width: Math.max(label.offsetWidth - TRAILING_TRACK, 8),
            }
          : { left: 0, width: 0 };
      });
      trackX.jump(-activeRef.current * w);
      placeLine(activeRef.current);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(viewport);
    if (stripRef.current) ro.observe(stripRef.current);
    return () => ro.disconnect();
  }, [trackX, placeLine]);

  // Track each panel's height: the viewport takes the active panel's, so a short
  // panel next to a long one doesn't leave blank scroll space below it.
  useLayoutEffect(() => {
    const panels = panelRefs.current.filter((el): el is HTMLElement => !!el);
    const read = () => setHeights(panelRefs.current.map((el) => el?.offsetHeight ?? 0));
    read();
    const ro = new ResizeObserver(read);
    for (const el of panels) ro.observe(el);
    return () => ro.disconnect();
  }, [tabs.length]);

  // Keep the active tab visible in the strip.
  useEffect(() => {
    const strip = stripRef.current;
    const el = tabRefs.current[active];
    if (!strip || !el) return;
    const target = el.offsetLeft - (strip.clientWidth - el.offsetWidth) / 2;
    strip.scrollTo({ left: Math.max(0, target), behavior: reduced ? "auto" : "smooth" });
  }, [active, reduced]);

  const go = (i: number) => {
    const next = Math.min(Math.max(i, 0), tabs.length - 1);
    const target = -next * widthRef.current;
    if (reduced) trackX.jump(target);
    else animate(trackX, target, spring.snappy);
    if (next !== activeRef.current) {
      activeRef.current = next;
      setActive(next);
      onChange?.(next);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next = (active + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    go(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <div className={className}>
      <div
        ref={stripRef}
        role="tablist"
        aria-orientation="horizontal"
        onKeyDown={onKeyDown}
        className="nav-chrome no-scrollbar relative flex overflow-x-auto border-b border-hairline px-2"
      >
        {tabs.map((tab, i) => {
          const selected = i === active;
          return (
            <button
              key={tab.id}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              id={`${baseId}-tab-${tab.id}`}
              role="tab"
              type="button"
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => go(i)}
              className={`relative h-11 ${fill ? "min-w-fit flex-1 px-2" : "shrink-0 px-3"} text-[13px] font-semibold uppercase tracking-[0.12em] transition-colors duration-200 active:opacity-70 ${
                selected ? "text-text" : "text-muted"
              }`}
            >
              <span
                ref={(el) => {
                  labelRefs.current[i] = el;
                }}
              >
                {tab.label}
              </span>
            </button>
          );
        })}
        <motion.span
          aria-hidden
          className="pointer-events-none absolute bottom-0 left-0 h-[2px] w-px origin-left rounded-full bg-white shadow-[0_0_8px_rgb(255_255_255/0.5)]"
          style={{ x: lineX, scaleX: lineScale, opacity: width > 0 ? 1 : 0 }}
        />
      </div>

      {/*
        overflow: clip (not hidden) so nothing can scroll this box programmatically.
        Its height follows the active panel (neighbours are cut to it mid-swipe).
      */}
      <div ref={viewportRef} className="overflow-clip" style={heights[active] ? { height: heights[active] } : undefined}>
        <motion.div
          className="flex items-start"
          // Before the first measurement (SSR paint) show the default panel via
          // the independent CSS translate property; motion owns transform after.
          style={{ x: trackX, translate: width > 0 ? "none" : `${-defaultIndex * 100}% 0` }}
          drag={width > 0 && tabs.length > 1 ? "x" : false}
          dragDirectionLock
          dragMomentum={false}
          dragElastic={0.14}
          dragConstraints={{ left: -(tabs.length - 1) * width, right: 0 }}
          onDragEnd={(_, info) => {
            const w = widthRef.current;
            let next = activeRef.current;
            if (info.offset.x < -w * 0.22 || info.velocity.x < -380) next += 1;
            else if (info.offset.x > w * 0.22 || info.velocity.x > 380) next -= 1;
            go(next);
          }}
        >
          {tabs.map((tab, i) => (
            <section
              key={tab.id}
              ref={(el) => {
                panelRefs.current[i] = el;
              }}
              id={`${baseId}-panel-${tab.id}`}
              role="tabpanel"
              aria-labelledby={`${baseId}-tab-${tab.id}`}
              inert={i !== active}
              className="w-full shrink-0"
              style={width > 0 ? { width } : undefined}
            >
              {tab.content}
            </section>
          ))}
        </motion.div>
      </div>
    </div>
  );
}
