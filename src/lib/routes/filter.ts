import type { Route } from "@/lib/validation/route";
import type { VehicleType } from "@/lib/validation/transport";

export type RouteFilter = {
  query: string;
  types: readonly VehicleType[];
};

/**
 * Filters a route list by text and vehicle type. This is a catalogue filter
 * (name, code, endpoints, stop names), not trip planning.
 */
export function filterRoutes(routes: readonly Route[], filter: RouteFilter): Route[] {
  const q = filter.query.trim().toLowerCase();
  return routes.filter((route) => {
    if (!filter.types.includes(route.vehicleType)) return false;
    if (!q) return true;
    const haystack = [route.code, route.name, ...route.directions.flatMap((d) => d.stops.map((s) => s.name))]
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });
}

/** Start and end of the outbound direction, which is how a route is labelled. */
export function routeEndpoints(route: Route) {
  const stops = route.directions[0].stops;
  return {
    start: stops[0]?.name ?? null,
    end: stops[stops.length - 1]?.name ?? null,
  };
}
