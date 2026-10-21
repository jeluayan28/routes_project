"use client";

import "leaflet/dist/leaflet.css";
import { divIcon, latLngBounds } from "leaflet";
import { useEffect, useEffectEvent, useMemo } from "react";
import { CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, useMap, useMapEvents } from "react-leaflet";
import { BUTUAN_DEFAULT_ZOOM, BUTUAN_MAP_CENTER } from "@/lib/constants";
import { resolveTileConfig } from "@/lib/map/config";
import { toTuple } from "@/lib/routes/geometry";
import type { Coordinate } from "@/lib/validation/transport";

export type EditorMapStop = { id: string; name: string; position: Coordinate; order: number | null };

export type EditorMapProps = {
  stops: readonly EditorMapStop[];
  /** Lines of the direction being edited (solid). */
  lines: readonly (readonly Coordinate[])[];
  /** Lines of the other direction, for context (dashed). */
  otherLines?: readonly (readonly Coordinate[])[];
  color: string;
  /** When on, a click reports the clicked point. */
  picking: boolean;
  /** A point chosen but not yet saved. */
  pending: Coordinate | null;
  /** A line being drawn by clicking, not yet part of the route. */
  drawing?: readonly Coordinate[];
  onPick: (point: Coordinate) => void;
  /** Change the number to re-fit the map to the content. */
  fitKey: number;
  label: string;
  className?: string;
};

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

function Clicks({ picking, onPick }: Pick<EditorMapProps, "picking" | "onPick">) {
  useMapEvents({
    click: (e) => {
      if (picking) onPick({ lat: round6(e.latlng.lat), lng: round6(e.latlng.lng) });
    },
  });
  return null;
}

function Fit({ points, fitKey }: { points: [number, number][]; fitKey: number }) {
  const map = useMap();
  const fit = useEffectEvent(() => {
    if (points.length > 0) map.fitBounds(latLngBounds(points), { padding: [40, 40], maxZoom: 17, animate: false });
  });
  useEffect(() => {
    fit();
  }, [fitKey]);
  return null;
}

export default function EditorMap({ stops, lines, otherLines = [], color, picking, pending, drawing = [], onPick, fitKey, label, className }: EditorMapProps) {
  const tiles = useMemo(() => resolveTileConfig(), []);
  const points = [
    ...stops.map((s) => toTuple(s.position)),
    ...lines.flatMap((l) => l.map(toTuple)),
    ...otherLines.flatMap((l) => l.map(toTuple)),
  ];

  return (
    <div role="region" aria-label={label} className={className}>
      <MapContainer
        center={toTuple(BUTUAN_MAP_CENTER)}
        zoom={BUTUAN_DEFAULT_ZOOM}
        minZoom={9}
        scrollWheelZoom
        className={`h-full w-full ${picking ? "cursor-crosshair" : ""}`}
      >
        <TileLayer attribution={tiles.attribution} url={tiles.url} maxZoom={tiles.maxZoom} referrerPolicy="strict-origin-when-cross-origin" />
        <Clicks picking={picking} onPick={onPick} />
        <Fit points={points} fitKey={fitKey} />

        {otherLines.map((line, i) => (
          <Polyline key={`o${i}`} positions={line.map(toTuple)} interactive={false} pathOptions={{ color, weight: 4, opacity: 0.6, dashArray: "2 10" }} />
        ))}
        {lines.map((line, i) => (
          <Polyline key={`l${i}`} positions={line.map(toTuple)} interactive={false} pathOptions={{ color, weight: 5, opacity: 0.9 }} />
        ))}
        {lines.flatMap((line, li) => line.map((p, pi) => (
          <CircleMarker key={`v${li}:${pi}`} center={toTuple(p)} radius={3} interactive={false} pathOptions={{ color, fillColor: "#fff", fillOpacity: 1, weight: 2 }} />
        )))}

        {stops.map((s) => (
          <Marker
            key={s.id}
            position={toTuple(s.position)}
            title={s.name}
            icon={divIcon({ className: "editor-stop", html: `<span>${s.order ?? ""}</span>`, iconSize: [28, 28], iconAnchor: [14, 14], popupAnchor: [0, -12] })}
          >
            <Popup>
              <p className="font-semibold">{s.order ? `${s.order}. ` : ""}{s.name}</p>
              <p className="text-xs text-muted-foreground">{s.position.lat}, {s.position.lng}</p>
            </Popup>
          </Marker>
        ))}

        {drawing.length > 0 && (
          <>
            <Polyline positions={drawing.map(toTuple)} interactive={false} pathOptions={{ color: "#b45309", weight: 4, dashArray: "6 6" }} />
            {drawing.map((p, i) => (
              <CircleMarker key={`d${i}`} center={toTuple(p)} radius={4} interactive={false} pathOptions={{ color: "#b45309", fillColor: "#fde68a", fillOpacity: 1, weight: 2 }} />
            ))}
          </>
        )}

        {pending && (
          <CircleMarker center={toTuple(pending)} radius={9} pathOptions={{ color: "#b45309", fillColor: "#f59e0b", fillOpacity: 0.9, weight: 3 }} />
        )}
      </MapContainer>
    </div>
  );
}
