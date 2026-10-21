import type { Coordinate } from "@/lib/validation/transport";

export const SITE_NAME = "Butuan Route Finder";

/**
 * Approximate map centre for Butuan City, used only to frame the base map.
 * This is not a transport record (no stop, terminal, or route).
 */
export const BUTUAN_MAP_CENTER: Coordinate = { lat: 8.9475, lng: 125.5406 };
export const BUTUAN_DEFAULT_ZOOM = 13;

/**
 * Generous box around Butuan City, used only to flag coordinates that are
 * probably typos (swapped lat/lng, wrong sign). It is a sanity check, never a
 * transport record, so widen it if a legitimate stop lies outside.
 */
export const BUTUAN_SERVICE_AREA = { south: 8.6, north: 9.3, west: 125.2, east: 125.9 } as const;

export function isInsideServiceArea(c: Coordinate): boolean {
  const b = BUTUAN_SERVICE_AREA;
  return c.lat >= b.south && c.lat <= b.north && c.lng >= b.west && c.lng <= b.east;
}

/** A verification older than this is treated as stale and needs review. */
export const VERIFICATION_STALE_AFTER_DAYS = 180;
