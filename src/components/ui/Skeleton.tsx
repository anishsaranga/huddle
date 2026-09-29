type SkeletonProps = {
  className?: string;
  /** "full" for circles/pills. Default "md". */
  rounded?: "sm" | "md" | "lg" | "full";
};

const radius = { sm: "rounded-md", md: "rounded-lg", lg: "rounded-2xl", full: "rounded-full" };

/** Shimmer placeholder. Size it with className (e.g. "h-4 w-24"). */
export function Skeleton({ className = "", rounded = "md" }: SkeletonProps) {
  return (
    <div
      aria-hidden
      className={`relative overflow-hidden bg-white/[0.05] ${radius[rounded]} ${className}`}
    >
      <div className="animate-shimmer absolute inset-0 bg-[linear-gradient(90deg,transparent,rgb(255_255_255/0.06),transparent)]" />
    </div>
  );
}
