"use client";

import { motion } from "motion/react";
import { ease } from "@/lib/ui/motion";

/**
 * Remounts on every tab navigation (Next templates are keyed per segment):
 * subtle fade + 8px rise, enter only. The wrapper ends at transform: none, so
 * it doesn't leave a containing block behind for fixed descendants.
 */
export default function AppTemplate({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: ease.out }}
    >
      {children}
    </motion.div>
  );
}
