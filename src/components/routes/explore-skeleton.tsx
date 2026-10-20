import { RouteListSkeleton } from "@/components/routes/route-list-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

export function ExploreSkeleton() {
  return (
    <div className="flex h-[calc(100svh-3.5rem)] min-h-[34rem] flex-col lg:flex-row">
      <div className="hidden w-[26rem] shrink-0 space-y-4 border-r p-4 lg:block">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-9 w-56 rounded-full" />
        <RouteListSkeleton />
      </div>
      <Skeleton className="min-h-0 flex-1 rounded-none" />
    </div>
  );
}
