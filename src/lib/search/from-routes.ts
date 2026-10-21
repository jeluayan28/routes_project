import type { RawFare, RawNetwork, RawRoute, RawStop } from "@/lib/search/types";
import type { Route } from "@/lib/validation/route";

/**
 * Adapts the app's display `Route` model to the engine's input. Used only for the
 * development sample data (status "sample"), which the engine accepts solely when
 * explicitly allowed, and which it labels as sample in every result.
 */
export function routesToRawNetwork(routes: readonly Route[]): RawNetwork {
  const stops = new Map<string, RawStop>();
  const raw: RawRoute[] = routes.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    transportType: r.vehicleType,
    status: r.status,
    lastVerifiedAt: null,
    directions: r.directions.map((d) => ({
      kind: d.kind,
      geometry: d.paths,
      stops: d.stops.map((s, i) => {
        if (!stops.has(s.id)) stops.set(s.id, { id: s.id, name: s.name, position: s.position, status: s.status });
        return { stopId: s.id, order: i + 1, canBoard: s.canBoard, canAlight: s.canAlight };
      }),
    })),
  }));

  const fares: RawFare[] = routes.flatMap((r) =>
    r.fares.map((f) => ({
      routeId: r.id, fromStopId: null, toStopId: null, category: f.category, amount: f.amount,
      effectiveFrom: "1970-01-01", effectiveUntil: null, status: f.status,
    })),
  );
  return { stops: [...stops.values()], routes: raw, fares };
}
