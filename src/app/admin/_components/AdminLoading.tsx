import { Skeleton } from "@/components/ui/Skeleton";

export function AdminLoading() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <Skeleton className="mb-3 h-3 w-24" />
      <Skeleton className="mb-6 h-10 w-52" rounded="lg" />
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-[72px] w-full" rounded="lg" />
        ))}
      </div>
    </div>
  );
}
