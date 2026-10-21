"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";
import type { TripMapProps } from "@/components/search/trip-map";

// Leaflet needs `window`, so the map is client-only and code-split.
const TripMap = dynamic(() => import("@/components/search/trip-map"), {
  ssr: false,
  loading: () => (
    <div role="status" className="h-full w-full">
      <Skeleton className="h-full w-full rounded-xl" />
      <span className="sr-only">Loading map…</span>
    </div>
  ),
});

export function TripMapLazy(props: TripMapProps) {
  return <TripMap {...props} />;
}
