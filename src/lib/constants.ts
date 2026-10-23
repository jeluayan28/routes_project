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

export const DEFAULT_VERIFICATION_STALE_DAYS = 180;

/** A whole number of days from 1 to 3650; anything else falls back to the default. */
export function parseStaleDays(raw: string | undefined): number {
  const n = Number(raw);
  return raw !== undefined && raw.trim() !== "" && Number.isInteger(n) && n >= 1 && n <= 3650 ? n : DEFAULT_VERIFICATION_STALE_DAYS;
}

/**
 * A verification older than this is treated as stale and needs review. Set
 * NEXT_PUBLIC_VERIFICATION_STALE_DAYS to change it (it is public so the server
 * and the browser agree; it is not a secret).
 */
export const VERIFICATION_STALE_AFTER_DAYS = parseStaleDays(process.env.NEXT_PUBLIC_VERIFICATION_STALE_DAYS);
