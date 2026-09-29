import { Skeleton } from "@/components/ui/Skeleton";

function Ring({ size }: { size: number }) {
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <Skeleton rounded="full" className="size-full" />
      <div className="absolute rounded-full bg-card" style={{ inset: Math.max(4, Math.round(size * 0.09)) }} />
    </div>
  );
}

/** /groups while loading: page title and two group cards. */
export function GroupsSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading groups" className="pt-safe px-safe">
      <div className="space-y-3 px-5 pb-5 pt-6">
        <Skeleton className="h-2.5 w-20" />
        <Skeleton className="h-9 w-52" />
      </div>
      <div className="space-y-3 px-4">
        {[0, 1].map((i) => (
          <div key={i} className="surface p-5">
            <Skeleton className="h-7 w-44" />
            <div className="mt-3 flex items-center gap-3">
              <Skeleton rounded="full" className="h-7 w-24" />
              <Skeleton className="h-2.5 w-32" />
            </div>
            <div className="mt-5 flex items-end justify-between border-t border-hairline pt-4">
              <div className="flex gap-3">
                {[0, 1, 2].map((j) => (
                  <Ring key={j} size={44} />
                ))}
              </div>
              <Skeleton className="h-7 w-14" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** A group while loading: header, tab strip, and a podium-shaped placeholder. */
export function GroupSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading group" className="pt-safe px-safe">
      <div className="grid grid-cols-[44px_1fr_auto] items-center gap-2 pb-3 pl-3 pr-4 pt-3">
        <Skeleton rounded="full" className="size-9" />
        <div className="space-y-2">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-2.5 w-36" />
        </div>
        <Skeleton rounded="full" className="h-7 w-20" />
      </div>
      <div className="flex gap-5 border-b border-hairline px-5 py-4">
        {[36, 36, 48, 60, 40].map((w, i) => (
          <div key={i} style={{ width: w }}>
            <Skeleton className="h-3" rounded="sm" />
          </div>
        ))}
      </div>
      <div className="space-y-3 px-4 pt-4">
        <div className="surface p-5">
          <div className="mb-5 flex justify-between">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-20" />
          </div>
          <div className="grid grid-cols-3 justify-items-center">
            {[0, 1, 2].map((i) => (
              <Ring key={i} size={104} />
            ))}
          </div>
        </div>
        <div className="surface space-y-4 p-5">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton rounded="full" className="size-10" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="h-2.5 w-20" />
              </div>
              <Skeleton className="h-5 w-24" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
