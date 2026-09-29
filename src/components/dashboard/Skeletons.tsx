import { Skeleton } from "@/components/ui/Skeleton";

/** Ring placeholder: a shimmering annulus (a shimmer disc with the center punched out in the page color). */
function RingSkeleton({ size, stroke }: { size: number; stroke: number }) {
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <div className="absolute inset-0">
        <Skeleton rounded="full" className="size-full" />
      </div>
      <div className="absolute rounded-full bg-bg" style={{ inset: stroke }} />
    </div>
  );
}

function CardSkeleton({ rows = 3, chart = false }: { rows?: number; chart?: boolean }) {
  return (
    <div className="surface p-5">
      <div className="mb-5 flex items-center justify-between">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-3 w-16" />
      </div>
      {chart && <Skeleton className="mb-5 h-28 w-full" rounded="lg" />}
      <div className="space-y-4">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center justify-between">
            <div className="space-y-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-2.5 w-16" />
            </div>
            <Skeleton className="h-7 w-14" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Home while its data loads: date switcher, three rings, cards. */
export function HomeSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading overview" className="pt-safe px-safe">
      <div className="flex flex-col items-center gap-2 px-3 pb-2 pt-4">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-2.5 w-24" />
      </div>
      <div className="grid grid-cols-3 px-3 pb-6 pt-6">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex flex-col items-center gap-3">
            <RingSkeleton size={104} stroke={7} />
            <Skeleton className="h-2.5 w-16" />
          </div>
        ))}
      </div>
      <div className="space-y-3 px-4 pt-7">
        <CardSkeleton rows={4} />
        <CardSkeleton rows={1} chart />
      </div>
    </div>
  );
}

/** Detail screens while loading: header, big ring, cards. */
export function DetailSkeleton({ label }: { label: string }) {
  return (
    <div aria-busy="true" aria-label={`Loading ${label}`} className="pt-safe px-safe">
      <div className="grid grid-cols-[44px_1fr_44px] items-center px-3 pb-1 pt-3">
        <Skeleton rounded="full" className="size-9" />
        <div className="flex flex-col items-center gap-2">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-2.5 w-20" />
        </div>
      </div>
      <div className="flex justify-center px-4 pb-6 pt-6">
        <RingSkeleton size={220} stroke={12} />
      </div>
      <div className="space-y-3 px-4">
        <CardSkeleton rows={3} />
        <CardSkeleton rows={0} chart />
      </div>
    </div>
  );
}
