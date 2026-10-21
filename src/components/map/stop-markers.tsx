"use client";

import { divIcon, type DivIcon, type Marker as LeafletMarker } from "leaflet";
import { Marker, Popup, useMap } from "react-leaflet";
import { VerificationBadge } from "@/components/common/verification-badge";
import { VEHICLE_LABEL } from "@/lib/format";
import { routeColor } from "@/lib/routes/colors";
import { DIRECTION_LABEL, collectStops, getDirection, type MapStop } from "@/lib/routes/geometry";
import type { DirectionKind, Route, RouteStop } from "@/lib/validation/route";

type StopRole = "start" | "end" | "stop";

const icons = new Map<string, DivIcon>();

/** Icons are shared per look, so many markers do not mean many icon objects. */
function stopIcon(role: StopRole, status: RouteStop["status"], dim: boolean): DivIcon {
  const key = `${role}:${status}:${dim}`;
  let icon = icons.get(key);
  if (!icon) {
    icon = divIcon({
      className: `stop-marker stop-marker--${role} stop-marker--${status}${dim ? " stop-marker--dim" : ""}`,
      html: "<span></span>",
      iconSize: [28, 28],
      iconAnchor: [14, 14],
      popupAnchor: [0, -12],
    });
    icons.set(key, icon);
  }
  return icon;
}

type StopMarkersProps = {
  routes: readonly Route[];
  selected: Route | null;
  activeDirection: DirectionKind | null;
  onSelectRoute?: (route: Route) => void;
};

export function StopMarkers({ routes, selected, activeDirection, onSelectRoute }: StopMarkersProps) {
  // With a selection, show that route's stops; otherwise every visible stop.
  const stops = collectStops(selected ? [selected] : routes);
  const activeStops = selected ? getDirection(selected, activeDirection).stops : [];

  return (
    <>
      {stops.map((entry) => {
        const index = activeStops.findIndex((s) => s.id === entry.stop.id);
        const role: StopRole =
          index === 0 ? "start" : index === activeStops.length - 1 && activeStops.length > 1 ? "end" : "stop";
        return (
          <StopMarker
            key={entry.stop.id}
            entry={entry}
            role={role}
            // A stop on the selected route but not in the shown direction.
            dim={Boolean(selected) && index === -1}
            onSelectRoute={onSelectRoute}
          />
        );
      })}
    </>
  );
}

function StopMarker({
  entry,
  role,
  dim,
  onSelectRoute,
}: {
  entry: MapStop;
  role: StopRole;
  dim: boolean;
  onSelectRoute?: (route: Route) => void;
}) {
  const { stop } = entry;
  return (
    <Marker
      position={[stop.position.lat, stop.position.lng]}
      icon={stopIcon(role, stop.status, dim)}
      title={stop.name}
      eventHandlers={{
        // Div icons get no accessible name from Leaflet; `title` alone is weak.
        add: (e) => (e.target as LeafletMarker).getElement()?.setAttribute("aria-label", `Stop: ${stop.name}`),
      }}
    >
      <Popup minWidth={220}>
        <StopPopup entry={entry} onSelectRoute={onSelectRoute} />
      </Popup>
    </Marker>
  );
}

function accessLabel(canBoard: boolean, canAlight: boolean): string {
  if (canBoard && canAlight) return "Boarding and drop-off";
  if (canBoard) return "Boarding only";
  if (canAlight) return "Drop-off only";
  return "No boarding or drop-off recorded";
}

function StopPopup({ entry, onSelectRoute }: { entry: MapStop; onSelectRoute?: (route: Route) => void }) {
  const map = useMap();
  const { stop, routes } = entry;
  return (
    <div className="space-y-2">
      <h3 className="text-base leading-tight font-semibold">{stop.name}</h3>
      <VerificationBadge status={stop.status} />
      <div>
        <p className="text-xs font-medium text-muted-foreground">
          {routes.length === 1 ? "Route" : "Routes"} serving this stop
        </p>
        <ul className="mt-1 space-y-2">
          {routes.map(({ route, directions, canBoard, canAlight }) => {
            const heading = (
              <>
                <span aria-hidden="true" className="size-3 shrink-0 rounded-full" style={{ background: routeColor(route.id) }} />
                <span className="font-medium">{route.code}</span>
                <span className="text-muted-foreground">· {VEHICLE_LABEL[route.vehicleType]}</span>
              </>
            );
            return (
              <li key={route.id}>
                {onSelectRoute ? (
                  <button
                    type="button"
                    className="flex items-center gap-2 rounded text-left underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    onClick={() => {
                      map.closePopup();
                      onSelectRoute(route);
                    }}
                  >
                    {heading}
                    <span className="sr-only">, show this route</span>
                  </button>
                ) : (
                  <p className="flex items-center gap-2">{heading}</p>
                )}
                <p className="ml-5 text-xs text-muted-foreground">
                  {accessLabel(canBoard, canAlight)} · {directions.map((d) => DIRECTION_LABEL[d]).join(" and ")}
                </p>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
