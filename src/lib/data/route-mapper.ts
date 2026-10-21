import { parseLineGeometry } from "@/lib/routes/geometry";
import type { Database } from "@/types/database";
import type { DirectionKind, Route, RouteDirection, RouteStop } from "@/lib/validation/route";

type Tables = Database["public"]["Tables"];
type Enums = Database["public"]["Enums"];

type StopRow = Pick<
  Tables["stops"]["Row"],
  "id" | "name" | "latitude" | "longitude" | "pickup_allowed" | "dropoff_allowed" | "verification_status"
>;

export type RouteRow = Pick<
  Tables["routes"]["Row"],
  "id" | "code" | "name" | "transport_type" | "verification_status"
> & {
  route_stops: Array<
    Pick<Tables["route_stops"]["Row"], "direction" | "stop_order" | "boarding_allowed" | "dropoff_allowed"> & {
      /** PostgREST returns null if the stop row is not visible to the caller. */
      stops: StopRow | null;
    }
  >;
};

export type ShapeRow = {
  route_id: string | null;
  direction: Enums["route_direction"] | null;
  geojson: unknown;
};

const DIRECTIONS: DirectionKind[] = ["outbound", "inbound"];

function toStop(rs: RouteRow["route_stops"][number]): RouteStop | null {
  const s = rs.stops;
  if (!s) return null;
  return {
    id: s.id,
    name: s.name,
    position: { lat: s.latitude, lng: s.longitude },
    status: s.verification_status,
    // A per-route override wins; NULL means "follow the stop".
    canBoard: rs.boarding_allowed ?? s.pickup_allowed,
    canAlight: rs.dropoff_allowed ?? s.dropoff_allowed,
  };
}

/**
 * Joins route, stop and shape rows into the app's Route model. Stops are
 * ordered by `stop_order` per direction. Shapes are used as stored: a direction
 * without a valid shape gets no line (it is never inferred from its stops).
 * Routes with no stops in any direction are kept with an empty outbound entry
 * so they can still be listed.
 */
export function buildRoutes(routeRows: readonly RouteRow[], shapeRows: readonly ShapeRow[]): Route[] {
  return routeRows.map((row) => {
    const directions: RouteDirection[] = [];
    for (const kind of DIRECTIONS) {
      const stops = row.route_stops
        .filter((rs) => rs.direction === kind)
        .sort((a, b) => a.stop_order - b.stop_order)
        .map(toStop)
        .filter((s): s is RouteStop => s !== null);
      const paths = shapeRows
        .filter((sh) => sh.route_id === row.id && sh.direction === kind)
        .flatMap((sh) => parseLineGeometry(sh.geojson));
      if (kind === "outbound" || stops.length > 0 || paths.length > 0) {
        directions.push({ kind, stops, paths });
      }
    }

    return {
      id: row.id,
      code: row.code ?? row.name,
      name: row.name,
      vehicleType: row.transport_type,
      status: row.verification_status,
      direction: directions.length > 1 ? "both" : "one-way",
      directions,
      fares: [],
    };
  });
}
