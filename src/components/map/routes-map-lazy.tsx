"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";
import type { RoutesMapProps } from "@/components/map/routes-map";

// Leaflet touches `window`, so the map is client-only and code-split.
const RoutesMap = dynamic(() => import("@/components/map/routes-map"), {
  ssr: false,
  loading: () => (
    <div role="status" className="relative h-full w-full">
      <Skeleton className="h-full w-full rounded-none" />
      <span className="sr-only">Loading map…</span>
    </div>
  ),
});

export function RoutesMapLazy(props: RoutesMapProps) {
  return <RoutesMap {...props} />;
}
