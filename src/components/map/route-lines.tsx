"use client";

import { useState } from "react";
import { Polyline, Popup, Tooltip, useMap } from "react-leaflet";
import { metersPerPixel, routesNearPoint, toTuple } from "@/lib/routes/geometry";
import { routeColor } from "@/lib/routes/colors";
import type { Coordinate } from "@/lib/validation/transport";
import type { DirectionKind, Route } from "@/lib/validation/route";

/** How close (in screen pixels) a click must be to count as being on a line. */
const HIT_PIXELS = 12;

type RouteLinesProps = {
  routes: readonly Route[];
  selectedId: string | null;
  /** Direction drawn solid. The route's other direction is drawn dashed. */
  activeDirection: DirectionKind | null;
  onSelect?: (route: Route) => void;
};

type Overlap = { at: Coordinate; routes: Route[] };

type Emphasis = "normal" | "dim" | "selected" | "other-direction";

/**
 * Draws only recorded geometry. A route (or direction) with no shape draws
 * nothing; lines are never inferred from stops.
 */
export function RouteLines({ routes, selectedId, activeDirection, onSelect }: RouteLinesProps) {
  const map = useMap();
  const [overlap, setOverlap] = useState<Overlap | null>(null);
  const hasSelection = routes.some((r) => r.id === selectedId);

  // The selected route is drawn last so it sits above the others.
  const ordered = hasSelection
    ? [...routes.filter((r) => r.id !== selectedId), ...routes.filter((r) => r.id === selectedId)]
    : routes;

  const handleLineClick = (route: Route, at: Coordinate) => {
    if (!onSelect) return;
    // Several routes can share one road; let the user choose instead of guessing.
    const meters = metersPerPixel(at.lat, map.getZoom()) * HIT_PIXELS;
    const near = routesNearPoint(routes, at, meters);
    if (near.length > 1) setOverlap({ at, routes: near });
    else onSelect(near[0] ?? route);
  };

  return (
    <>
      {ordered.map((route) => {
        const isSelected = route.id === selectedId;
        const color = routeColor(route.id);
        const active = route.directions.find((d) => d.kind === activeDirection)?.kind ?? route.directions[0].kind;

        return route.directions.flatMap((direction) =>
          direction.paths.map((path, i) => {
            const emphasis: Emphasis = !hasSelection
              ? "normal"
              : isSelected
                ? direction.kind === active
                  ? "selected"
                  : "other-direction"
                : "dim";
            return (
              <Segment
                key={`${route.id}:${direction.kind}:${i}`}
                positions={path.map(toTuple)}
                color={color}
                emphasis={emphasis}
                label={`${route.code} · ${route.name}`}
                interactive={Boolean(onSelect)}
                onClick={(at) => handleLineClick(route, at)}
              />
            );
          }),
        );
      })}

      {overlap && (
        <Popup position={[overlap.at.lat, overlap.at.lng]} eventHandlers={{ remove: () => setOverlap(null) }}>
          <div className="space-y-2">
            <p className="font-semibold">{overlap.routes.length} routes share this road</p>
            <ul className="space-y-1">
              {overlap.routes.map((route) => (
                <li key={route.id}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded px-1 py-1.5 text-left underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    onClick={() => {
                      setOverlap(null);
                      map.closePopup();
                      onSelect?.(route);
                    }}
                  >
                    <span aria-hidden="true" className="size-3 shrink-0 rounded-full" style={{ background: routeColor(route.id) }} />
                    <span>
                      {route.code} · {route.name}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </Popup>
      )}
    </>
  );
}

type SegmentProps = {
  positions: [number, number][];
  color: string;
  emphasis: Emphasis;
  label: string;
  interactive: boolean;
  onClick: (at: Coordinate) => void;
};

function Segment({ positions, color, emphasis, label, interactive, onClick }: SegmentProps) {
  const highlighted = emphasis === "selected" || emphasis === "other-direction";
  const weight = emphasis === "selected" ? 7 : emphasis === "other-direction" ? 5 : emphasis === "dim" ? 3 : 4;
  return (
    <>
      {highlighted && (
        // White casing keeps the highlighted line legible on any base map.
        <Polyline positions={positions} interactive={false} pathOptions={{ color: "#ffffff", weight: weight + 4, opacity: 0.9 }} />
      )}
      <Polyline
        positions={positions}
        interactive={false}
        pathOptions={{
          color,
          weight,
          opacity: emphasis === "dim" ? 0.35 : 0.9,
          // Must be reset explicitly: Leaflet keeps old options when a restyle omits them.
          dashArray: emphasis === "other-direction" ? "2 10" : undefined,
        }}
      />
      {interactive && (
        // A wider invisible line makes thin routes easy to hit with a finger.
        <Polyline
          positions={positions}
          // className must be a prop: Leaflet reads it only when the path is created.
          className="route-hit-line"
          pathOptions={{ color: "#000000", weight: 22, opacity: 0 }}
          eventHandlers={{ click: (e) => onClick({ lat: e.latlng.lat, lng: e.latlng.lng }) }}
        >
          <Tooltip sticky>{label}</Tooltip>
        </Polyline>
      )}
    </>
  );
}
