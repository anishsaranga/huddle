import type { CSSProperties, ReactNode } from "react";
import { STAGGER } from "@/lib/ui/motion";

type StaggerProps = {
  children: ReactNode;
  /** Seconds before the first item. */
  delay?: number;
  /** Seconds between items. */
  stagger?: number;
  className?: string;
};

/**
 * Container that reveals its <StaggerItem> children one after another.
 *
 * Pure CSS (see `.stagger-item` in globals.css), so it works as a server
 * component: the HTML is visible with no JavaScript, and the entrance starts as
 * soon as the stylesheet applies rather than after hydration (no flash of
 * hidden content, nothing stuck invisible if the JS bundle is slow or fails).
 */
export function Stagger({ children, delay = 0, stagger = STAGGER, className = "" }: StaggerProps) {
  const style = { "--stagger-delay": `${delay}s`, "--stagger-step": `${stagger}s` } as CSSProperties;
  return (
    <div className={`stagger ${className}`} style={style}>
      {children}
    </div>
  );
}

type StaggerItemProps = {
  children: ReactNode;
  className?: string;
  as?: "div" | "li" | "section";
  /** DOM id (e.g. an in-page anchor). */
  id?: string;
  /**
   * Position in the sequence. Defaults to the item's place among its siblings
   * (CSS :nth-child); set it when items are split across wrapper elements.
   */
  index?: number;
};

/** One step of a <Stagger>: rises 12px and fades in. */
export function StaggerItem({ children, className = "", as: Comp = "div", id, index }: StaggerItemProps) {
  const style = index === undefined ? undefined : ({ "--i": index } as CSSProperties);
  return (
    <Comp id={id} className={`stagger-item ${className}`} style={style}>
      {children}
    </Comp>
  );
}
