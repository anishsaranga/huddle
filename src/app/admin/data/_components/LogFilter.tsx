"use client";

import { usePathname, useRouter } from "next/navigation";
import { useOptimistic, useTransition } from "react";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import type { IngestFilter } from "@/lib/admin/data";

const OPTIONS: { value: IngestFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "ok", label: "OK" },
  { value: "errors", label: "Errors" },
];

/** Status filter for the ingest log. Lives in the URL (`?status=`); switching resets to page 1. */
export function LogFilter({ value }: { value: IngestFilter }) {
  const router = useRouter();
  const pathname = usePathname();
  const [, startTransition] = useTransition();
  const [current, setCurrent] = useOptimistic(value);

  return (
    <SegmentedControl
      ariaLabel="Status filter"
      size="sm"
      options={OPTIONS}
      value={current}
      onChange={(next) => {
        if (next === current) return;
        startTransition(() => {
          setCurrent(next);
          router.push(next === "all" ? pathname : `${pathname}?status=${next}`);
        });
      }}
    />
  );
}
