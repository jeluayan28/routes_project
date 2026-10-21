import type { Coordinate } from "@/lib/validation/transport";
import type { DirectionKind, Route, RouteDirection, RouteStop } from "@/lib/validation/route";

export type LatLngTuple = [lat: number, lng: number];

export const toTuple = (c: Coordinate): LatLngTuple => [c.lat, c.lng];

export const DIRECTION_LABEL: Record<DirectionKind, string> = {
  outbound: "Outbound",
  inbound: "Inbound",
};

export function getDirection(route: Route, kind: DirectionKind | null | undefined): RouteDirection {
  return route.directions.find((d) => d.kind === kind) ?? route.directions[0];
}

export function hasGeometry(route: Route): boolean {
  return route.directions.some((d) => d.paths.length > 0);
}

/**
 * Every point the selected route occupies: recorded lines and stops, across
 * all of its directions. Used to fit the map. Empty if nothing is recorded.
 */
export function routePoints(route: Route): LatLngTuple[] {
  return route.directions.flatMap((d) => [
    ...d.paths.flatMap((line) => line.map(toTuple)),
    ...d.stops.map((s) => toTuple(s.position)),
  ]);
}

export type StopRouteLink = {
  route: Route;
  directions: DirectionKind[];
  canBoard: boolean;
  canAlight: boolean;
};

export type MapStop = {
  stop: RouteStop;
  routes: StopRouteLink[];
};

/**
 * One entry per physical stop (by id) with every route that serves it. A stop
 * shared by several routes or both directions appears once.
 */
export function collectStops(routes: readonly Route[]): MapStop[] {
  const byId = new Map<string, MapStop>();
  for (const route of routes) {
    for (const direction of route.directions) {
      for (const stop of direction.stops) {
        let entry = byId.get(stop.id);
        if (!entry) {
          entry = { stop, routes: [] };
          byId.set(stop.id, entry);
        }
        let link = entry.routes.find((l) => l.route.id === route.id);
        if (!link) {
          link = { route, directions: [], canBoard: false, canAlight: false };
          entry.routes.push(link);
        }
        if (!link.directions.includes(direction.kind)) link.directions.push(direction.kind);
        link.canBoard ||= stop.canBoard;
        link.canAlight ||= stop.canAlight;
      }
    }
  }
  return [...byId.values()];
}

const METERS_PER_DEGREE = 111_320;

/** Planar distance in metres from a point to a segment (fine at city scale). */
function distanceToSegment(p: Coordinate, a: Coordinate, b: Coordinate): number {
  const kx = Math.cos((p.lat * Math.PI) / 180) * METERS_PER_DEGREE;
  const ky = METERS_PER_DEGREE;
  const ax = (a.lng - p.lng) * kx;
  const ay = (a.lat - p.lat) * ky;
  const bx = (b.lng - p.lng) * kx;
  const by = (b.lat - p.lat) * ky;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

/** Routes with a recorded line within `toleranceMeters` of the point. */
export function routesNearPoint(
  routes: readonly Route[],
  point: Coordinate,
  toleranceMeters: number,
): Route[] {
  return routes.filter((route) =>
    route.directions.some((d) =>
      d.paths.some((line) =>
        line.some((p, i) => i > 0 && distanceToSegment(point, line[i - 1], p) <= toleranceMeters),
      ),
    ),
  );
}

/** Metres covered by one screen pixel at a latitude and Web Mercator zoom. */
export function metersPerPixel(lat: number, zoom: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}

/**
 * Parses GeoJSON (LineString or MultiLineString, [lng, lat] order) into lines
 * of coordinates. Anything malformed yields no lines rather than a guess.
 */
export function parseLineGeometry(geojson: unknown): Coordinate[][] {
  if (!geojson || typeof geojson !== "object") return [];
  const { type, coordinates } = geojson as { type?: unknown; coordinates?: unknown };
  const rawLines =
    type === "LineString" ? [coordinates] : type === "MultiLineString" ? coordinates : null;
  if (!Array.isArray(rawLines)) return [];

  const lines: Coordinate[][] = [];
  for (const raw of rawLines) {
    if (!Array.isArray(raw)) return [];
    const line: Coordinate[] = [];
    for (const pt of raw) {
      if (!Array.isArray(pt) || pt.length < 2) return [];
      const [lng, lat] = pt;
      if (
        typeof lng !== "number" || typeof lat !== "number" ||
        !Number.isFinite(lng) || !Number.isFinite(lat) ||
        Math.abs(lat) > 90 || Math.abs(lng) > 180
      ) {
        return [];
      }
      line.push({ lat, lng });
    }
    if (line.length < 2) return [];
    lines.push(line);
  }
  return lines;
}

/** Great-circle distance in metres between two points. */
export function distanceMeters(a: Coordinate, b: Coordinate): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}
