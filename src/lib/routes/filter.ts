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
    const haystack = [route.code, route.name, ...route.stops.map((s) => s.name)]
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });
}

export function routeEndpoints(route: Route) {
  return {
    start: route.stops[0]?.name ?? null,
    end: route.stops[route.stops.length - 1]?.name ?? null,
  };
}
