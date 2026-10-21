"use client";

import type { Map as LeafletMap } from "leaflet";
import { Crosshair, Minus, Plus, ScanSearch, X, type LucideIcon } from "lucide-react";
import { useCallback, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";

type MapControlsProps = {
  map: LeafletMap | null;
  /** Return to the configured Butuan City view. */
  onReturnToCity: () => void;
  /** Present only while a route is selected. */
  onFitRoute?: () => void;
  onClearSelection?: () => void;
};

/** Zoom level as an external store so the +/- buttons disable at the limits. */
function useZoom(map: LeafletMap | null): number | null {
  const subscribe = useCallback(
    (notify: () => void) => {
      map?.on("zoomend", notify);
      return () => {
        map?.off("zoomend", notify);
      };
    },
    [map],
  );
  return useSyncExternalStore(
    subscribe,
    () => (map ? map.getZoom() : null),
    () => null,
  );
}

function ControlButton({
  label,
  icon: Icon,
  onClick,
  disabled,
  className,
}: {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex size-11 items-center justify-center bg-background text-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 sm:size-9",
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-5 sm:size-4" />
    </button>
  );
}

/**
 * Zoom and view buttons. They replace Leaflet's built-in zoom control so they
 * are real labelled buttons with touch-sized targets.
 */
export function MapControls({ map, onReturnToCity, onFitRoute, onClearSelection }: MapControlsProps) {
  const zoom = useZoom(map);
  const canZoomIn = map !== null && zoom !== null && zoom < map.getMaxZoom();
  const canZoomOut = map !== null && zoom !== null && zoom > map.getMinZoom();

  return (
    <div role="group" aria-label="Map controls" className="absolute top-3 right-3 z-[500] flex flex-col items-end gap-2">
      <div className="flex flex-col overflow-hidden rounded-lg border shadow-sm">
        <ControlButton label="Zoom in" icon={Plus} disabled={!canZoomIn} onClick={() => map?.zoomIn()} />
        <ControlButton label="Zoom out" icon={Minus} disabled={!canZoomOut} onClick={() => map?.zoomOut()} className="border-t" />
      </div>
      <div className="flex flex-col overflow-hidden rounded-lg border shadow-sm">
        <ControlButton label="Return to Butuan City view" icon={Crosshair} onClick={onReturnToCity} />
        {onFitRoute && <ControlButton label="Fit map to selected route" icon={ScanSearch} onClick={onFitRoute} className="border-t" />}
        {onClearSelection && <ControlButton label="Clear route selection" icon={X} onClick={onClearSelection} className="border-t" />}
      </div>
    </div>
  );
}
