import { computeDashboard, type Dashboard } from "@/lib/admin/dashboard";
import type { AdminClient } from "@/lib/admin/session";
import type { RouteDraft } from "@/lib/admin/route-form";
import { parseLineGeometry } from "@/lib/routes/geometry";
import type { ExistingData, ParsedImport } from "@/lib/import/validate";
import { referencedRouteIds } from "@/lib/import/validate";
import type { Database } from "@/types/database";

type Tables = Database["public"]["Tables"];
export type RouteRow = Tables["routes"]["Row"];
export type StopRow = Tables["stops"]["Row"];
export type FareRow = Tables["fare_rules"]["Row"];
export type VerificationRow = Tables["route_verifications"]["Row"];
export type BatchRow = Tables["import_batches"]["Row"];

const PAGE = 1000;

/** PostgREST caps responses (1000 rows by default), so page through everything. */
async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

export async function loadDashboard(supabase: AdminClient): Promise<{ dashboard: Dashboard; routes: RouteRow[]; stops: StopRow[] }> {
  const [routes, stops, fares, shapes, reports] = await Promise.all([
    fetchAll<RouteRow>((a, b) => supabase.from("routes").select("*").order("id").range(a, b)),
    fetchAll<StopRow>((a, b) => supabase.from("stops").select("*").order("id").range(a, b)),
    fetchAll<Pick<FareRow, "route_id" | "verification_status" | "verified_at">>((a, b) =>
      supabase.from("fare_rules").select("route_id, verification_status, verified_at").order("id").range(a, b)),
    fetchAll<{ route_id: string; verification_status: "unverified" | "verified" | "outdated"; last_verified_at: string | null }>((a, b) =>
      supabase.from("route_shapes").select("route_id, verification_status, last_verified_at").order("id").range(a, b)),
    fetchAll<{ route_id: string | null }>((a, b) =>
      supabase.from("route_reports").select("route_id").in("status", ["new", "reviewing"]).order("id").range(a, b)),
  ]);

  const dashboard = computeDashboard({
    now: new Date(),
    routes,
    routeIdsWithFares: [...new Set(fares.map((f) => f.route_id))],
    openReportRouteIds: reports.flatMap((r) => (r.route_id ? [r.route_id] : [])),
    stops,
    shapes,
    fares,
  });
  return { dashboard, routes, stops };
}

export type RouteListItem = RouteRow & { stopCount: number; fareCount: number };

export async function listRoutes(supabase: AdminClient): Promise<RouteListItem[]> {
  const [routes, stopLinks, fares] = await Promise.all([
    fetchAll<RouteRow>((a, b) => supabase.from("routes").select("*").order("name").order("id").range(a, b)),
    fetchAll<{ route_id: string }>((a, b) => supabase.from("route_stops").select("route_id").order("id").range(a, b)),
    fetchAll<{ route_id: string }>((a, b) => supabase.from("fare_rules").select("route_id").order("id").range(a, b)),
  ]);
  const count = (rows: { route_id: string }[]) => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.route_id, (m.get(r.route_id) ?? 0) + 1);
    return m;
  };
  const stops = count(stopLinks);
  const fareCounts = count(fares);
  return routes.map((r) => ({ ...r, stopCount: stops.get(r.id) ?? 0, fareCount: fareCounts.get(r.id) ?? 0 }));
}

export type EditorStop = { id: string; name: string; latitude: number; longitude: number; status: StopRow["verification_status"]; barangay: string | null };

export type EditorData = {
  routeId: string;
  route: RouteRow;
  draft: RouteDraft;
  stops: Record<string, EditorStop>;
  fares: FareRow[];
  verifications: VerificationRow[];
  batch: BatchRow | null;
};

const toEditorStop = (s: StopRow): EditorStop => ({
  id: s.id, name: s.name, latitude: s.latitude, longitude: s.longitude, status: s.verification_status, barangay: s.barangay,
});

export async function loadEditorData(supabase: AdminClient, routeId: string): Promise<EditorData | null> {
  const { data: route, error } = await supabase.from("routes").select("*").eq("id", routeId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!route) return null;

  const [links, shapes, fares, verifications, batch] = await Promise.all([
    supabase.from("route_stops").select("*, stops(*)").eq("route_id", routeId).order("stop_order"),
    supabase.from("route_shapes_geojson").select("direction, geojson, source").eq("route_id", routeId),
    supabase.from("fare_rules").select("*").eq("route_id", routeId).order("effective_from", { ascending: false }),
    supabase.from("route_verifications").select("*").eq("route_id", routeId).order("created_at", { ascending: false }),
    route.import_batch_id
      ? supabase.from("import_batches").select("*").eq("id", route.import_batch_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  for (const r of [links, shapes, fares, verifications, batch]) if (r.error) throw new Error(r.error.message);

  const stops: Record<string, EditorStop> = {};
  const directions: RouteDraft["directions"] = [];
  for (const kind of ["outbound", "inbound"] as const) {
    const rows = (links.data ?? []).filter((l) => l.direction === kind);
    const shape = (shapes.data ?? []).find((s) => s.direction === kind);
    if (kind === "inbound" && rows.length === 0 && !shape) continue;
    for (const l of rows) if (l.stops) stops[l.stop_id] = toEditorStop(l.stops as StopRow);
    directions.push({
      kind,
      stops: rows.map((l) => ({ stopId: l.stop_id, boarding: l.boarding_allowed, dropoff: l.dropoff_allowed })),
      lines: shape ? parseLineGeometry(shape.geojson) : [],
      geometrySource: shape?.source ?? "",
    });
  }
  if (directions.length === 0) directions.push({ kind: "outbound", stops: [], lines: [], geometrySource: "" });

  return {
    routeId,
    route,
    draft: {
      code: route.code ?? "",
      name: route.name,
      transportType: route.transport_type,
      description: route.description ?? "",
      originLabel: route.origin_label ?? "",
      destinationLabel: route.destination_label ?? "",
      directions,
    },
    stops,
    fares: fares.data ?? [],
    verifications: verifications.data ?? [],
    batch: (batch.data as BatchRow | null) ?? null,
  };
}

/** Stops used by fares but not on the route's current direction lists still need names. */
export async function loadStopsByIds(supabase: AdminClient, ids: string[]): Promise<Record<string, EditorStop>> {
  if (ids.length === 0) return {};
  const { data, error } = await supabase.from("stops").select("*").in("id", ids);
  if (error) throw new Error(error.message);
  return Object.fromEntries((data ?? []).map((s) => [s.id, toEditorStop(s)]));
}

export async function loadExistingForImport(supabase: AdminClient, parsed: ParsedImport): Promise<ExistingData> {
  const [stops, routes] = await Promise.all([
    fetchAll<ExistingData["stops"][number]>((a, b) => supabase.from("stops").select("id, name, latitude, longitude").order("id").range(a, b)),
    fetchAll<ExistingData["routes"][number]>((a, b) => supabase.from("routes").select("id, code, name, transport_type, verification_status").order("id").range(a, b)),
  ]);
  const ids = referencedRouteIds(parsed).filter((id) => routes.some((r) => r.id.toLowerCase() === id));
  const routeStops: ExistingData["routeStops"] = [];
  const fares: ExistingData["fares"] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const [rs, fr] = await Promise.all([
      supabase.from("route_stops").select("route_id, direction, stop_id").in("route_id", chunk),
      supabase.from("fare_rules").select("route_id, from_stop_id, to_stop_id, passenger_type, effective_from, effective_until").in("route_id", chunk),
    ]);
    if (rs.error) throw new Error(rs.error.message);
    if (fr.error) throw new Error(fr.error.message);
    routeStops.push(...(rs.data ?? []));
    fares.push(...(fr.data ?? []));
  }
  return { stops, routes, routeStops, fares };
}

export async function listBatches(supabase: AdminClient, limit = 10): Promise<BatchRow[]> {
  const { data, error } = await supabase.from("import_batches").select("*").order("created_at", { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function searchStops(supabase: AdminClient, query: string, limit = 20): Promise<EditorStop[]> {
  // Escape LIKE wildcards so the search is a plain substring match.
  const term = query.trim().replace(/[\\%_]/g, (c) => `\\${c}`);
  if (term === "") return [];
  const { data, error } = await supabase.from("stops").select("*").ilike("name", `%${term}%`).order("name").limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map(toEditorStop);
}
