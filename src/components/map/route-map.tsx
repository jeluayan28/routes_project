"use client";

import "leaflet/dist/leaflet.css";
import { Browser, latLngBounds, type Map as LeafletMap } from "leaflet";
import { useEffect, useEffectEvent, useMemo, useRef, useState, type ReactNode } from "react";
import { MapContainer, TileLayer } from "react-leaflet";
import { MapControls } from "@/components/map/map-controls";
import { MapStatus } from "@/components/map/map-status";
import { RouteLines } from "@/components/map/route-lines";
import { StopMarkers } from "@/components/map/stop-markers";
import { BUTUAN_DEFAULT_ZOOM, BUTUAN_MAP_CENTER } from "@/lib/constants";
import { routePoints, toTuple } from "@/lib/routes/geometry";
import { resolveTileConfig } from "@/lib/map/config";
import { cn } from "@/lib/utils";
import type { DirectionKind, Route } from "@/lib/validation/route";
import type { Coordinate } from "@/lib/validation/transport";

export type RouteMapProps = {
  routes: readonly Route[];
  selectedId?: string | null;
  /** Direction of the selected route drawn solid; the other is dashed. Defaults to the first. */
  selectedDirection?: DirectionKind | null;
  /** Makes lines and stop popups able to select a route. Omit for a read-only map. */
  onSelect?: (route: Route) => void;
  onClearSelection?: () => void;
  /** Initial centre and zoom, and the view "Return to Butuan City" restores. */
  center?: Coordinate;
  zoom?: number;
  /** Zoom, return-to-city, fit and clear buttons. */
  showControls?: boolean;
  /** Extra controls (filters, route picker) shown top-left. */
  toolbar?: ReactNode;
  loading?: boolean;
  /** When set, no routes are drawn and the message is shown instead. */
  error?: string | null;
  emptyMessage?: string;
  /**
   * Use for a map that owns the viewport. Otherwise the scroll wheel does not
   * zoom and a single finger scrolls the page instead of dragging the map.
   */
  captureGestures?: boolean;
  label: string;
  className?: string;
};

const FIT_PADDING: [number, number] = [48, 48];
const MIN_ZOOM = 9;
/** After this many failed tile requests the user is told the base map is unavailable. */
const TILE_ERROR_LIMIT = 4;

export default function RouteMap({
  routes,
  selectedId = null,
  selectedDirection = null,
  onSelect,
  onClearSelection,
  center = BUTUAN_MAP_CENTER,
  zoom = BUTUAN_DEFAULT_ZOOM,
  showControls = true,
  toolbar,
  loading = false,
  error = null,
  emptyMessage = "No routes to show on the map.",
  captureGestures = false,
  label,
  className,
}: RouteMapProps) {
  const [map, setMap] = useState<LeafletMap | null>(null);
  // react-leaflet removes its map whenever effects are torn down (React Strict Mode in
  // development, or a cached page being hidden), yet keeps the dead map in state. A new
  // key makes the next mount build a fresh map instead of adding layers to a removed one.
  const [mapKey, setMapKey] = useState(0);
  const [tilesFailed, setTilesFailed] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const tileErrors = useRef(0);
  const hadSelection = useRef(false);
  const tiles = useMemo(() => resolveTileConfig(), []);

  useEffect(() => {
    return () => setMapKey((k) => k + 1);
  }, []);

  // A failed request must never show routes, so nothing is drawn on error.
  const shown = useMemo(() => (error ? [] : routes), [error, routes]);
  const selected = shown.find((r) => r.id === selectedId) ?? null;

  const returnToCity = () => {
    map?.setView(toTuple(center), zoom);
  };

  const fitSelected = (animate: boolean) => {
    if (!map || !selected) return;
    const points = routePoints(selected);
    if (points.length === 0) return;
    map.fitBounds(latLngBounds(points), { padding: FIT_PADDING, maxZoom: 17, animate });
  };

  // Frame on selection changes only, so filtering or refetching never yanks the view.
  const frameSelection = useEffectEvent(() => {
    if (selected) {
      hadSelection.current = true;
      fitSelected(true);
    } else if (hadSelection.current) {
      hadSelection.current = false;
      returnToCity();
    }
  });
  const selectedKey = selected?.id ?? null;
  useEffect(() => {
    if (map) frameSelection();
  }, [map, selectedKey]);

  // Keep the map correct when its box changes (rotation, collapsing the panel).
  const handleResize = useEffectEvent(() => {
    if (!map) return;
    map.invalidateSize({ pan: false });
    fitSelected(false);
  });
  useEffect(() => {
    const el = containerRef.current;
    if (!map || !el || typeof ResizeObserver === "undefined") return;
    let frame = 0;
    let last = "";
    const observer = new ResizeObserver(() => {
      const size = `${el.clientWidth}x${el.clientHeight}`;
      if (size === last) return;
      last = size;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => handleResize());
    });
    observer.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [map]);

  const dragging = captureGestures || !Browser.mobile;
  const showEmpty = !loading && !error && routes.length === 0;

  return (
    <div
      ref={containerRef}
      role="region"
      aria-label={label}
      aria-busy={loading}
      className={cn("relative isolate", className)}
    >
      <MapContainer
        key={mapKey}
        ref={setMap}
        center={toTuple(center)}
        zoom={zoom}
        minZoom={MIN_ZOOM}
        zoomControl={false}
        scrollWheelZoom={captureGestures}
        dragging={dragging}
        className="h-full w-full"
      >
        <TileLayer
          attribution={tiles.attribution}
          url={tiles.url}
          maxZoom={tiles.maxZoom}
          // OSM's policy asks for a Referer; origin-only is enough.
          referrerPolicy="strict-origin-when-cross-origin"
          eventHandlers={{
            tileerror: () => {
              tileErrors.current += 1;
              if (tileErrors.current >= TILE_ERROR_LIMIT) setTilesFailed(true);
            },
            tileload: () => {
              tileErrors.current = 0;
              setTilesFailed(false);
            },
          }}
        />
        <RouteLines
          routes={shown}
          selectedId={selected?.id ?? null}
          activeDirection={selectedDirection}
          onSelect={onSelect}
        />
        <StopMarkers
          routes={shown}
          selected={selected}
          activeDirection={selectedDirection}
          onSelectRoute={onSelect}
        />
      </MapContainer>

      {toolbar && <div className="absolute top-3 left-3 z-[500] max-w-[calc(100%-4.5rem)]">{toolbar}</div>}
      {showControls && (
        <MapControls
          map={map}
          onReturnToCity={returnToCity}
          onFitRoute={selected ? () => fitSelected(true) : undefined}
          onClearSelection={selected ? onClearSelection : undefined}
        />
      )}

      <MapStatus
        loading={loading}
        error={error}
        empty={showEmpty ? emptyMessage : null}
        tilesFailed={tilesFailed}
      />
      <p role="status" className="sr-only">
        {selected ? `Showing route ${selected.code}, ${selected.name}` : ""}
      </p>
    </div>
  );
}
