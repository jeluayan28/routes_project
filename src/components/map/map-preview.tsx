import { RouteMapLazy } from "@/components/map/route-map-lazy";
import type { Route } from "@/lib/validation/route";

/** Read-only map for the home page. */
export function MapPreview({ routes }: { routes: readonly Route[] }) {
  return (
    <div className="h-72 overflow-hidden rounded-2xl border shadow-xs sm:h-96">
      <RouteMapLazy
        routes={routes}
        showControls={false}
        emptyMessage="No routes have been published yet."
        label={
          routes.length > 0
            ? "Map of Butuan City with available routes"
            : "Map of Butuan City. No routes have been published yet."
        }
        className="h-full w-full"
      />
    </div>
  );
}
