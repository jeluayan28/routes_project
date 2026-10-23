import { buildRoutes, type RouteRow, type ShapeRow } from "@/lib/data/route-mapper";
import { isSampleDataEnabled } from "@/lib/data/config";
import { readPublicEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import type { Route } from "@/lib/validation/route";

/**
 * Where the returned data came from:
 * - "database": approved records from Supabase
 * - "sample":   development fixtures, explicitly enabled
 */
export type DataSource = "database" | "sample";

export type DataResult<T> =
  | { status: "ok"; data: T; source: DataSource }
  | { status: "error"; message: string };

const ROUTE_COLUMNS = `
  id, code, name, transport_type, verification_status, last_verified_at,
  route_stops (
    direction, stop_order, boarding_allowed, dropoff_allowed,
    stops ( id, name, latitude, longitude, pickup_allowed, dropoff_allowed, verification_status )
  )
`;

/**
 * Data-access boundary for routes. Pages depend only on these functions.
 *
 * Only active, verified routes are requested; row-level security enforces the
 * same rule. Any failure is returned as an error. It is never replaced with
 * sample data: fixtures are used only when explicitly enabled.
 */
export async function getRoutes(): Promise<DataResult<Route[]>> {
  if (isSampleDataEnabled()) {
    // Imported lazily so fixtures stay out of the normal data path.
    const { SAMPLE_ROUTES } = await import("@/dev-fixtures/sample-routes");
    return { status: "ok", data: SAMPLE_ROUTES, source: "sample" };
  }

  if (!readPublicEnv().configured) {
    return { status: "error", message: "Route data is not available: the database connection is not configured." };
  }

  try {
    const supabase = await createClient();
    const [routes, shapes] = await Promise.all([
      supabase
        .from("routes")
        .select(ROUTE_COLUMNS)
        .eq("status", "active")
        .eq("verification_status", "verified")
        .order("name"),
      supabase.from("route_shapes_geojson").select("route_id, direction, geojson"),
    ]);

    if (routes.error || shapes.error) {
      console.error("getRoutes failed", routes.error ?? shapes.error);
      return { status: "error", message: "We couldn't load route data right now. Please try again in a moment." };
    }

    return {
      status: "ok",
      data: buildRoutes(routes.data as unknown as RouteRow[], shapes.data as ShapeRow[]),
      source: "database",
    };
  } catch (error) {
    console.error("getRoutes threw", error);
    return { status: "error", message: "We couldn't load route data right now. Please try again in a moment." };
  }
}

export async function getRouteById(id: string): Promise<DataResult<Route | null>> {
  const result = await getRoutes();
  if (result.status === "error") return result;
  return {
    status: "ok",
    data: result.data.find((r) => r.id === id) ?? null,
    source: result.source,
  };
}
