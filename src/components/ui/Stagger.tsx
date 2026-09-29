"use client";

import { motion, type Variants } from "motion/react";
import type { ReactNode } from "react";
import { spring, STAGGER } from "@/lib/ui/motion";

type StaggerProps = {
  children: ReactNode;
  /** Seconds before the first item. */
  delay?: number;
  /** Seconds between items. */
  stagger?: number;
  className?: string;
};

/** Container that reveals its <StaggerItem> children one after another. */
export function Stagger({ children, delay = 0, stagger = STAGGER, className }: StaggerProps) {
  const variants: Variants = {
    hidden: {},
    show: { transition: { delayChildren: delay, staggerChildren: stagger } },
  };
  return (
    <motion.div className={className} variants={variants} initial="hidden" animate="show">
      {children}
    </motion.div>
  );
}

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { ...spring.soft, opacity: { duration: 0.35 } } },
};

type StaggerItemProps = {
  children: ReactNode;
  className?: string;
  as?: "div" | "li" | "section";
  /** DOM id (e.g. an in-page anchor). */
  id?: string;
};

/** One step of a <Stagger>: rises 12px and fades in. */
export function StaggerItem({ children, className, as = "div", id }: StaggerItemProps) {
  const Comp = as === "li" ? motion.li : as === "section" ? motion.section : motion.div;
  return (
    <Comp id={id} className={className} variants={itemVariants}>
      {children}
    </Comp>
  );
}
