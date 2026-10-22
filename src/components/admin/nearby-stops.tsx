"use client";

import { useEffect, useState } from "react";
import { nearbyStopsAction } from "@/lib/admin/actions/routes";
import { DUPLICATE_RADIUS_METERS, type NearbyStop } from "@/lib/admin/nearby";
import type { Coordinate } from "@/lib/validation/transport";

/**
 * Stops already recorded near a chosen location, nearest first, so a new stop
 * is not created on top of an existing one. Anything within a few metres is
 * flagged as a possible duplicate.
 */
export function NearbyStops({ point }: { point: Coordinate | null }) {
  const [result, setResult] = useState<{ key: string; stops: NearbyStop[] | "error" } | null>(null);
  const key = point ? `${point.lat},${point.lng}` : null;

  useEffect(() => {
    if (!point || !key) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const res = await nearbyStopsAction(point.lat, point.lng);
      if (!cancelled) setResult({ key, stops: res.ok ? res.data : "error" });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [point, key]);

  if (!point || !key) return null;
  if (!result || result.key !== key) return <p role="status" className="text-sm text-muted-foreground">Looking for nearby stops…</p>;
  if (result.stops === "error") return <p role="alert" className="text-sm text-amber-800">Couldn&apos;t check for nearby stops.</p>;
  if (result.stops.length === 0) return <p role="status" className="text-sm text-muted-foreground">No recorded stops within 150 m.</p>;

  return (
    <div role="status" className="space-y-1 text-sm">
      <p className="font-medium">Stops already near here</p>
      <ul className="space-y-0.5">
        {result.stops.map((s) => (
          <li key={s.id}>
            {s.name} · {s.meters} m
            {s.meters <= DUPLICATE_RADIUS_METERS && <strong className="ml-2 text-amber-800">Possible duplicate</strong>}
          </li>
        ))}
      </ul>
    </div>
  );
}
