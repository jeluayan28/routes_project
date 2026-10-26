"use client";

import "leaflet/dist/leaflet.css";
import { latLngBounds } from "leaflet";
import { useEffect, useEffectEvent, useMemo } from "react";
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip, useMap } from "react-leaflet";
import { BUTUAN_DEFAULT_ZOOM, BUTUAN_MAP_CENTER } from "@/lib/constants";
import { resolveTileConfig } from "@/lib/map/config";
import { toTuple } from "@/lib/routes/geometry";
import { routeColor } from "@/lib/routes/colors";
import type { Journey } from "@/lib/search/types";
import type { Coordinate } from "@/lib/validation/transport";

export type TripMapProps = {
  journey: Journey | null;
  origin: { label: string; position: Coordinate };
  destination: { label: string; position: Coordinate };
  label: string;
  className?: string;
};

function Fit({ points, token }: { points: [number, number][]; token: string }) {
  const map = useMap();
  const fit = useEffectEvent(() => {
    if (points.length > 0) map.fitBounds(latLngBounds(points), { padding: [40, 40], maxZoom: 17, animate: false });
  });
  useEffect(() => {
    fit();
  }, [token]);

  // The map sits in a panel that can be hidden (mobile list view) or resized
  // (rotation, window resize). Leaflet has to be told, and the journey re-framed.
  useEffect(() => {
    const el = map.getContainer();
    if (typeof ResizeObserver === "undefined") return;
    let frame = 0;
    let last = "";
    const observer = new ResizeObserver(() => {
      const size = `${el.clientWidth}x${el.clientHeight}`;
      if (size === last || el.clientWidth === 0) return;
      last = size;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        map.invalidateSize({ pan: false });
        fit();
      });
    });
    observer.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [map]);
  return null;
}

/**
 * The chosen journey on a map. Only recorded geometry is drawn, as lines; a ride
 * without recorded geometry shows only its boarding and drop-off stops. Walking is
 * not drawn: its distance is an estimate and no walking path is known.
 */
export default function TripMap({ journey, origin, destination, label, className }: TripMapProps) {
  const tiles = useMemo(() => resolveTileConfig(), []);
  const rides = journey?.steps.flatMap((s) => (s.type === "ride" ? [s] : [])) ?? [];

  const points: [number, number][] = [
    toTuple(origin.position),
    toTuple(destination.position),
    ...rides.flatMap((r) => [
      toTuple(r.board.position),
      toTuple(r.alight.position),
      ...(r.geometry.status === "ok" ? r.geometry.lines.flatMap((l) => l.map(toTuple)) : []),
    ]),
  ];

  return (
    <div role="region" aria-label={label} className={className}>
      <MapContainer center={toTuple(BUTUAN_MAP_CENTER)} zoom={BUTUAN_DEFAULT_ZOOM} minZoom={9} scrollWheelZoom className="h-full w-full">
        <TileLayer attribution={tiles.attribution} url={tiles.url} maxZoom={tiles.maxZoom} referrerPolicy="strict-origin-when-cross-origin" />
        <Fit points={points} token={journey?.id ?? "none"} />

        {rides.map((ride, i) =>
          ride.geometry.status === "ok"
            ? ride.geometry.lines.map((line, k) => (
                <Polyline key={`${ride.routeId}:${i}:${k}`} positions={line.map(toTuple)} interactive={false} pathOptions={{ color: routeColor(ride.routeId), weight: 6, opacity: 0.9 }} />
              ))
            : null,
        )}

        {rides.flatMap((ride, i) => [
          <CircleMarker key={`b${i}`} center={toTuple(ride.board.position)} radius={7} pathOptions={{ color: routeColor(ride.routeId), fillColor: "#ffffff", fillOpacity: 1, weight: 3 }}>
            <Tooltip>{`Board: ${ride.board.name}`}</Tooltip>
          </CircleMarker>,
          <CircleMarker key={`a${i}`} center={toTuple(ride.alight.position)} radius={7} pathOptions={{ color: routeColor(ride.routeId), fillColor: routeColor(ride.routeId), fillOpacity: 1, weight: 3 }}>
            <Tooltip>{`Get off: ${ride.alight.name}`}</Tooltip>
          </CircleMarker>,
        ])}

        <CircleMarker center={toTuple(origin.position)} radius={9} pathOptions={{ color: "#172d46", fillColor: "#20b8a6", fillOpacity: 1, weight: 3 }}>
          <Tooltip permanent direction="top">{`Start: ${origin.label}`}</Tooltip>
        </CircleMarker>
        <CircleMarker center={toTuple(destination.position)} radius={9} pathOptions={{ color: "#172d46", fillColor: "#f2b84b", fillOpacity: 1, weight: 3 }}>
          <Tooltip permanent direction="top">{`Destination: ${destination.label}`}</Tooltip>
        </CircleMarker>
      </MapContainer>
    </div>
  );
}
