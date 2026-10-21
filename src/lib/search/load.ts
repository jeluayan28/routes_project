import { fetchAll } from "@/lib/data/paginate";
import { isSampleDataEnabled } from "@/lib/data/config";
import type { DataResult } from "@/lib/data/routes";
import { readPublicEnv } from "@/lib/env";
import { parseLineGeometry } from "@/lib/routes/geometry";
import { routesToRawNetwork } from "@/lib/search/from-routes";
import type { KnownLandmark, KnownStop } from "@/lib/search/locations";
import type { RawFare, RawNetwork, RawRoute, RawStop } from "@/lib/search/types";
import { createClient } from "@/lib/supabase/server";
import type { DirectionKind, FareCategory } from "@/lib/validation/route";
import type { VehicleType, VerificationStatus } from "@/lib/validation/transport";

export type SearchData = {
  network: RawNetwork;
  stops: KnownStop[];
  landmarks: KnownLandmark[];
};

// Row shapes, as the database returns them.
export type RouteRowIn = { id: string; code: string | null; name: string; transport_type: VehicleType; status: "draft" | "active" | "inactive"; verification_status: VerificationStatus; last_verified_at: string | null };
export type LinkRowIn = { route_id: string; direction: DirectionKind; stop_order: number; boarding_allowed: boolean | null; dropoff_allowed: boolean | null; stop_id: string };
export type StopRowIn = { id: string; name: string; latitude: number; longitude: number; pickup_allowed: boolean; dropoff_allowed: boolean; verification_status: VerificationStatus };
export type ShapeRowIn = { route_id: string | null; direction: DirectionKind | null; geojson: unknown; verification_status: VerificationStatus | null };
export type FareRowIn = { route_id: string; from_stop_id: string | null; to_stop_id: string | null; passenger_type: FareCategory; amount: number; effective_from: string; effective_until: string | null; verification_status: VerificationStatus };
export type LandmarkRowIn = { id: string; name: string; category: string; latitude: number; longitude: number; verification_status: VerificationStatus };

export type SearchRows = {
  routes: RouteRowIn[];
  links: LinkRowIn[];
  stops: StopRowIn[];
  shapes: ShapeRowIn[];
  fares: FareRowIn[];
  landmarks: LandmarkRowIn[];
};

/**
 * Joins database rows into the engine's input.
 *
 *  - Boarding/drop-off: a route's own setting wins; a blank one follows the stop.
 *  - Geometry is used only if the shape itself is verified; otherwise none.
 *  - A route that is not active is handed over as unverified so it cannot be searched.
 */
export function assembleSearchData(rows: SearchRows): SearchData {
  const stopById = new Map(rows.stops.map((s) => [s.id, s]));

  const stops: RawStop[] = rows.stops.map((s) => ({ id: s.id, name: s.name, position: { lat: s.latitude, lng: s.longitude }, status: s.verification_status }));

  const routes: RawRoute[] = rows.routes.map((r) => {
    const links = rows.links.filter((l) => l.route_id === r.id);
    const kinds = (["outbound", "inbound"] as const).filter((k) => links.some((l) => l.direction === k));
    return {
      id: r.id,
      code: r.code ?? r.name,
      name: r.name,
      transportType: r.transport_type,
      status: r.status === "active" ? r.verification_status : "unverified",
      lastVerifiedAt: r.last_verified_at,
      directions: kinds.map((kind) => ({
        kind,
        stops: links
          .filter((l) => l.direction === kind)
          .map((l) => {
            const stop = stopById.get(l.stop_id);
            return {
              stopId: l.stop_id,
              order: l.stop_order,
              canBoard: l.boarding_allowed ?? stop?.pickup_allowed ?? false,
              canAlight: l.dropoff_allowed ?? stop?.dropoff_allowed ?? false,
            };
          }),
        geometry: rows.shapes
          .filter((s) => s.route_id === r.id && s.direction === kind && s.verification_status === "verified")
          .flatMap((s) => parseLineGeometry(s.geojson)),
      })),
    };
  });

  const fares: RawFare[] = rows.fares.map((f) => ({
    routeId: f.route_id,
    fromStopId: f.from_stop_id,
    toStopId: f.to_stop_id,
    category: f.passenger_type,
    amount: Number(f.amount),
    effectiveFrom: f.effective_from,
    effectiveUntil: f.effective_until,
    status: f.verification_status,
  }));

  return {
    network: { stops, routes, fares },
    stops: stops.map((s) => ({ id: s.id, name: s.name, position: s.position, status: s.status })),
    landmarks: rows.landmarks.map((l) => ({ id: l.id, name: l.name, category: l.category, position: { lat: l.latitude, lng: l.longitude }, status: l.verification_status })),
  };
}

/**
 * Everything the search needs, from approved data only. Row-level security hides
 * anything unapproved from this public client, and the engine checks again.
 * Any failure is returned as an error: the search never runs on partial data and
 * never falls back to sample data unless it is explicitly enabled.
 */
export async function loadSearchData(): Promise<DataResult<SearchData>> {
  if (isSampleDataEnabled()) {
    const { SAMPLE_ROUTES } = await import("@/dev-fixtures/sample-routes");
    const network = routesToRawNetwork(SAMPLE_ROUTES);
    return {
      status: "ok",
      source: "sample",
      data: { network, stops: network.stops.map((s) => ({ ...s })), landmarks: [] },
    };
  }
  if (!readPublicEnv().configured) {
    return { status: "error", message: "Route search is not available: the database connection is not configured." };
  }
  try {
    const db = await createClient();
    const [routes, links, stops, shapes, fares, landmarks] = await Promise.all([
      fetchAll<RouteRowIn>((a, b) =>
        db.from("routes").select("id, code, name, transport_type, status, verification_status, last_verified_at").eq("status", "active").eq("verification_status", "verified").order("id").range(a, b)),
      fetchAll<LinkRowIn>((a, b) =>
        db.from("route_stops").select("route_id, direction, stop_order, boarding_allowed, dropoff_allowed, stop_id").order("id").range(a, b)),
      fetchAll<StopRowIn>((a, b) =>
        db.from("stops").select("id, name, latitude, longitude, pickup_allowed, dropoff_allowed, verification_status").eq("verification_status", "verified").order("id").range(a, b)),
      fetchAll<ShapeRowIn>((a, b) =>
        db.from("route_shapes_geojson").select("route_id, direction, geojson, verification_status").eq("verification_status", "verified").order("id").range(a, b)),
      fetchAll<FareRowIn>((a, b) =>
        db.from("fare_rules").select("route_id, from_stop_id, to_stop_id, passenger_type, amount, effective_from, effective_until, verification_status").eq("verification_status", "verified").order("id").range(a, b)),
      fetchAll<LandmarkRowIn>((a, b) =>
        db.from("landmarks").select("id, name, category, latitude, longitude, verification_status").eq("verification_status", "verified").order("id").range(a, b)),
    ]);
    return { status: "ok", source: "database", data: assembleSearchData({ routes, links, stops, shapes, fares, landmarks }) };
  } catch (error) {
    console.error("loadSearchData failed", error);
    return { status: "error", message: "We couldn't load route data right now. Please try again in a moment." };
  }
}
