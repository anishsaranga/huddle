"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import type { ReactElement } from "react";
import { spring } from "@/lib/ui/motion";

const MotionLink = motion.create(Link);

type Tab = { href: string; label: string; icon: ReactElement };

const iconProps = {
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

const tabs: Tab[] = [
  {
    href: "/home",
    label: "Home",
    icon: (
      <svg {...iconProps}>
        <path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z" />
      </svg>
    ),
  },
  {
    href: "/groups",
    label: "Community",
    icon: (
      <svg {...iconProps}>
        <circle cx="9" cy="8.5" r="3.2" />
        <path d="M3 19c.4-3.3 2.9-5 6-5s5.6 1.7 6 5" />
        <path d="M15.5 5.6a3.2 3.2 0 0 1 0 5.8" />
        <path d="M17.5 14.3c1.8.6 3.1 2.1 3.5 4.7" />
      </svg>
    ),
  },
  {
    href: "/sync",
    label: "Sync",
    icon: (
      <svg {...iconProps}>
        <path d="M20 11a8 8 0 0 0-14-4.5L4 9" />
        <path d="M4 4v5h5" />
        <path d="M4 13a8 8 0 0 0 14 4.5L20 15" />
        <path d="M20 20v-5h-5" />
      </svg>
    ),
  },
  {
    href: "/profile",
    label: "Profile",
    icon: (
      <svg {...iconProps}>
        <circle cx="12" cy="8.5" r="3.6" />
        <path d="M4.5 20c.6-3.9 3.7-6 7.5-6s6.9 2.1 7.5 6" />
      </svg>
    ),
  },
];

/** Detail screens reached from Home keep the Home tab lit. */
const HOME_DETAILS = ["/recovery", "/sleep", "/strain"];

export function TabBar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="nav-chrome pb-safe px-safe fixed inset-x-0 bottom-0 z-50 border-t border-hairline bg-[rgba(10,11,13,0.92)] backdrop-blur-xl backdrop-saturate-150"
    >
      <ul className="mx-auto flex max-w-md items-stretch" style={{ height: "var(--tabbar-h)" }}>
        {tabs.map((tab) => {
          const active =
            pathname === tab.href ||
            pathname.startsWith(`${tab.href}/`) ||
            (tab.href === "/home" && HOME_DETAILS.some((d) => pathname === d || pathname.startsWith(`${d}/`)));
          return (
            <li key={tab.href} className="relative flex-1">
              {active && (
                <motion.span
                  layoutId="tabbar-indicator"
                  aria-hidden
                  className="absolute inset-x-0 top-[-1px] mx-auto h-[2px] w-8 rounded-full bg-white shadow-[0_0_10px_rgb(255_255_255/0.55)]"
                  transition={spring.snappy}
                />
              )}
              <MotionLink
                href={tab.href}
                aria-current={active ? "page" : undefined}
                whileTap="pressed"
                className={`flex h-full flex-col items-center justify-center gap-1 transition-colors duration-200 ${
                  active ? "text-white" : "text-muted"
                }`}
              >
                <motion.span
                  className="block"
                  variants={{ pressed: { scale: 0.82 } }}
                  transition={spring.bouncy}
                >
                  {tab.icon}
                </motion.span>
                <span className="text-[10px] font-semibold uppercase tracking-[0.1em]">
                  {tab.label}
                </span>
              </MotionLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
