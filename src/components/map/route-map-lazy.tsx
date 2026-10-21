"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";
import type { RouteMapProps } from "@/components/map/route-map";

// Leaflet touches `window`, so the map is client-only and code-split.
const RouteMap = dynamic(() => import("@/components/map/route-map"), {
  ssr: false,
  loading: () => (
    <div role="status" className="relative h-full w-full">
      <Skeleton className="h-full w-full rounded-none" />
      <span className="sr-only">Loading map…</span>
    </div>
  ),
});

export function RouteMapLazy(props: RouteMapProps) {
  return <RouteMap {...props} />;
}
