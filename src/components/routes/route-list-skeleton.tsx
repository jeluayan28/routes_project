import { Skeleton } from "@/components/ui/skeleton";

export function RouteListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div role="status" aria-label="Loading routes" className="space-y-3">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="space-y-3 rounded-xl border bg-card p-4">
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ))}
      <span className="sr-only">Loading routes…</span>
    </div>
  );
}
