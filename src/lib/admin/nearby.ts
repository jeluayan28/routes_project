import { distanceMeters } from "@/lib/routes/geometry";
import type { Coordinate } from "@/lib/validation/transport";

export type NearbyStop = { id: string; name: string; latitude: number; longitude: number; meters: number };

/** Closer than this and a new stop is probably the same place as an existing one. */
export const DUPLICATE_RADIUS_METERS = 15;
export const NEARBY_RADIUS_METERS = 150;

/** Stops within `radius` metres of a point, nearest first. */
export function findNearbyStops(
  stops: readonly { id: string; name: string; latitude: number; longitude: number }[],
  point: Coordinate,
  radius = NEARBY_RADIUS_METERS,
): NearbyStop[] {
  return stops
    .map((s) => ({ ...s, meters: Math.round(distanceMeters(point, { lat: s.latitude, lng: s.longitude })) }))
    .filter((s) => s.meters <= radius)
    .sort((a, b) => a.meters - b.meters || a.name.localeCompare(b.name));
}

/** Nearby stops close enough to be the same place. */
export const possibleDuplicates = (nearby: readonly NearbyStop[]) => nearby.filter((s) => s.meters <= DUPLICATE_RADIUS_METERS);

/** A bounding box (degrees) that contains the radius, for a cheap database pre-filter. */
export function boundingBox(point: Coordinate, radiusMeters: number) {
  const dLat = radiusMeters / 111_320;
  const dLng = radiusMeters / (111_320 * Math.max(0.01, Math.cos((point.lat * Math.PI) / 180)));
  return { minLat: point.lat - dLat, maxLat: point.lat + dLat, minLng: point.lng - dLng, maxLng: point.lng + dLng };
}
