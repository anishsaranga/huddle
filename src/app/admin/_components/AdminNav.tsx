"use client";

import { usePathname, useRouter } from "next/navigation";
import { useOptimistic, useTransition } from "react";
import { SegmentedControl } from "@/components/ui/SegmentedControl";

const SECTIONS = [
  { value: "allowlist", label: "Allowlist" },
  { value: "groups", label: "Groups" },
  { value: "users", label: "Users" },
] as const;

type Section = (typeof SECTIONS)[number]["value"];

function sectionOf(pathname: string): Section {
  const seg = pathname.split("/")[2];
  return SECTIONS.find((s) => s.value === seg)?.value ?? "allowlist";
}

/** Section switcher. The pill moves immediately (optimistic); the page follows. */
export function AdminNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [section, setSection] = useOptimistic(sectionOf(pathname));

  return (
    <SegmentedControl
      ariaLabel="Admin section"
      options={[...SECTIONS]}
      value={section}
      onChange={(next) => {
        if (next === section) return;
        startTransition(() => {
          setSection(next);
          router.push(`/admin/${next}`);
        });
      }}
    />
  );
}
