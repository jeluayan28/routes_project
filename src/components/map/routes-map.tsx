"use client";

import "leaflet/dist/leaflet.css";
import { latLngBounds, type LatLngTuple, type Map as LeafletMap } from "leaflet";
import { useCallback, useEffect, useState } from "react";
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip } from "react-leaflet";
import { MapControls } from "@/components/map/map-controls";
import { BUTUAN_DEFAULT_ZOOM, BUTUAN_MAP_CENTER } from "@/lib/constants";
import type { Route } from "@/lib/validation/route";
import type { Coordinate } from "@/lib/validation/transport";

export type RoutesMapProps = {
  routes: readonly Route[];
  selectedId?: string | null;
  /** Makes route lines clickable. Omit for a read-only map. */
  onSelect?: (route: Route) => void;
  /** Shows a "Clear selection" control while a route is selected. */
  onClearSelection?: () => void;
  showControls?: boolean;
  label: string;
  className?: string;
};

const toTuple = (c: Coordinate): LatLngTuple => [c.lat, c.lng];

const COLORS = {
  route: "#64748b",
  selected: "#2563eb",
  start: "#16a34a",
  end: "#dc2626",
} as const;

export default function RoutesMap({
  routes,
  selectedId = null,
  onSelect,
  onClearSelection,
  showControls = true,
  label,
  className,
}: RoutesMapProps) {
  const [map, setMap] = useState<LeafletMap | null>(null);
  const selected = routes.find((r) => r.id === selectedId) ?? null;

  const frame = useCallback(() => {
    if (!map) return;
    const targets = selected ? [selected] : routes;
    const points = targets.flatMap((r) => r.path.map(toTuple));
    if (points.length > 1) {
      map.fitBounds(latLngBounds(points), { padding: [40, 40], maxZoom: 16 });
    } else {
      map.setView(toTuple(BUTUAN_MAP_CENTER), BUTUAN_DEFAULT_ZOOM);
    }
  }, [map, routes, selected]);

  // Re-frame when the selection or the visible route set changes.
  useEffect(() => {
    frame();
  }, [frame]);

  // Draw the selected route last so it sits on top.
  const ordered = selected ? [...routes.filter((r) => r.id !== selected.id), selected] : routes;

  return (
    <div role="region" aria-label={label} className={`relative ${className ?? ""}`}>
      <MapContainer
        ref={setMap}
        center={toTuple(BUTUAN_MAP_CENTER)}
        zoom={BUTUAN_DEFAULT_ZOOM}
        scrollWheelZoom={false}
        className="h-full w-full"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {ordered.map((route) => {
          const isSelected = route.id === selected?.id;
          return (
            <Polyline
              key={route.id}
              positions={route.path.map(toTuple)}
              interactive={Boolean(onSelect)}
              pathOptions={{
                color: isSelected ? COLORS.selected : COLORS.route,
                weight: isSelected ? 7 : 4,
                opacity: isSelected || !selected ? 0.9 : 0.5,
              }}
              eventHandlers={onSelect ? { click: () => onSelect(route) } : undefined}
            >
              <Tooltip sticky>{`${route.code} · ${route.name}`}</Tooltip>
            </Polyline>
          );
        })}
        {selected?.stops.map((stop, i, all) => {
          const isStart = i === 0;
          const isEnd = i === all.length - 1 && all.length > 1;
          return (
            <CircleMarker
              key={stop.id}
              center={toTuple(stop.position)}
              radius={isStart || isEnd ? 9 : 6}
              pathOptions={{
                color: isStart ? COLORS.start : isEnd ? COLORS.end : COLORS.selected,
                fillColor: isStart ? COLORS.start : isEnd ? COLORS.end : "#ffffff",
                fillOpacity: 1,
                weight: 3,
              }}
            >
              <Tooltip>{stop.name}</Tooltip>
            </CircleMarker>
          );
        })}
      </MapContainer>
      {showControls && (
        <MapControls onResetView={frame} onClearSelection={selected ? onClearSelection : undefined} />
      )}
    </div>
  );
}
