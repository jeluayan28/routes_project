import { RoutesMapLazy } from "@/components/map/routes-map-lazy";
import type { Route } from "@/lib/validation/route";

/** Read-only map for the home page. */
export function MapPreview({ routes }: { routes: readonly Route[] }) {
  return (
    <div className="isolate h-72 overflow-hidden rounded-2xl border shadow-xs sm:h-96">
      <RoutesMapLazy
        routes={routes}
        showControls={false}
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
