import type { Coordinate } from "@/lib/validation/transport";

export const SITE_NAME = "Butuan Route Finder";

/**
 * Approximate map centre for Butuan City, used only to frame the base map.
 * This is not a transport record (no stop, terminal, or route).
 */
export const BUTUAN_MAP_CENTER: Coordinate = { lat: 8.9475, lng: 125.5406 };
export const BUTUAN_DEFAULT_ZOOM = 13;
