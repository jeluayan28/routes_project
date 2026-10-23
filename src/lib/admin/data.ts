import { computeDashboard, type Dashboard } from "@/lib/admin/dashboard";
import type { AuditEntry } from "@/lib/admin/audit";
import type { QualityInput } from "@/lib/admin/quality";
import type { InspectionInput } from "@/lib/admin/report-inspection";
import { todayInManila } from "@/lib/dates";
import type { AdminClient } from "@/lib/admin/session";
import { fetchAll } from "@/lib/data/paginate";
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

export type ReportListItem = Pick<Tables["route_reports"]["Row"], "id" | "report_type" | "description" | "reporter_contact" | "status" | "created_at" | "updated_at" | "route_id" | "stop_id" | "resolution_note" | "direction"> & { routeName: string | null; stopName: string | null };

/** Public reports with the names of what they refer to. Reporter contact details are for administrators only. */
export async function listReports(supabase: AdminClient): Promise<ReportListItem[]> {
  const [reports, routes, stops] = await Promise.all([
    fetchAll<Tables["route_reports"]["Row"]>((a, b) => supabase.from("route_reports").select("*").order("created_at", { ascending: false }).order("id").range(a, b)),
    fetchAll<{ id: string; name: string }>((a, b) => supabase.from("routes").select("id, name").order("id").range(a, b)),
    fetchAll<{ id: string; name: string }>((a, b) => supabase.from("stops").select("id, name").order("id").range(a, b)),
  ]);
  const routeNames = new Map(routes.map((r) => [r.id, r.name]));
  const stopNames = new Map(stops.map((x) => [x.id, x.name]));
  return reports.map((r) => ({
    id: r.id, report_type: r.report_type, description: r.description, reporter_contact: r.reporter_contact, status: r.status,
    created_at: r.created_at, updated_at: r.updated_at, route_id: r.route_id, stop_id: r.stop_id,
    resolution_note: r.resolution_note, direction: r.direction,
    routeName: r.route_id ? (routeNames.get(r.route_id) ?? null) : null,
    stopName: r.stop_id ? (stopNames.get(r.stop_id) ?? null) : null,
  }));
}

/** The newest audit entries, optionally for one kind of record. */
export async function listAudit(supabase: AdminClient, opts: { entity?: string; limit: number }): Promise<AuditEntry[]> {
  let query = supabase.from("audit_logs").select("*").order("id", { ascending: false }).limit(opts.limit);
  if (opts.entity) query = query.eq("entity_type", opts.entity);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as AuditEntry[];
}

export async function loadDashboard(supabase: AdminClient): Promise<{ dashboard: Dashboard; routes: RouteRow[]; stops: StopRow[]; recent: AuditEntry[] }> {
  const [routes, stops, fares, shapes, reports, recent] = await Promise.all([
    fetchAll<RouteRow>((a, b) => supabase.from("routes").select("*").order("id").range(a, b)),
    fetchAll<StopRow>((a, b) => supabase.from("stops").select("*").order("id").range(a, b)),
    fetchAll<Pick<FareRow, "route_id" | "verification_status" | "verified_at">>((a, b) =>
      supabase.from("fare_rules").select("route_id, verification_status, verified_at").order("id").range(a, b)),
    fetchAll<{ route_id: string; verification_status: "unverified" | "verified" | "outdated"; last_verified_at: string | null }>((a, b) =>
      supabase.from("route_shapes").select("route_id, verification_status, last_verified_at").order("id").range(a, b)),
    fetchAll<{ route_id: string | null; status: string }>((a, b) =>
      supabase.from("route_reports").select("route_id, status").in("status", ["new", "reviewing"]).order("id").range(a, b)),
    listAudit(supabase, { limit: 10 }),
  ]);

  const dashboard = computeDashboard({
    now: new Date(),
    routes,
    routeIdsWithFares: [...new Set(fares.map((f) => f.route_id))],
    openReportRouteIds: reports.flatMap((r) => (r.route_id ? [r.route_id] : [])),
    pendingReports: reports.filter((r) => r.status === "new").length,
    stops,
    shapes,
    fares,
  });
  return { dashboard, routes, stops, recent };
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

/** Everything needed to compare one report with the records it is about. */
export async function loadReportDetail(supabase: AdminClient, id: string): Promise<{ report: Tables["route_reports"]["Row"]; inspection: InspectionInput } | null> {
  const { data: report, error } = await supabase.from("route_reports").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!report) return null;

  const [route, stop, links, shapes, fares, stopUse, siblings] = await Promise.all([
    report.route_id ? supabase.from("routes").select("*").eq("id", report.route_id).maybeSingle() : null,
    report.stop_id ? supabase.from("stops").select("*").eq("id", report.stop_id).maybeSingle() : null,
    report.route_id ? supabase.from("route_stops").select("direction, stop_order, stops(name)").eq("route_id", report.route_id) : null,
    report.route_id ? supabase.from("route_shapes").select("direction, verification_status").eq("route_id", report.route_id) : null,
    report.route_id ? supabase.from("fare_rules").select("passenger_type, amount, effective_from, effective_until, verification_status, source_description, from_stop_id").eq("route_id", report.route_id) : null,
    report.stop_id ? supabase.from("route_stops").select("route_id").eq("stop_id", report.stop_id) : null,
    report.stop_id
      ? supabase.from("route_reports").select("id", { count: "exact", head: true }).eq("stop_id", report.stop_id).in("status", ["new", "reviewing"]).neq("id", id)
      : report.route_id
        ? supabase.from("route_reports").select("id", { count: "exact", head: true }).eq("route_id", report.route_id).in("status", ["new", "reviewing"]).neq("id", id)
        : null,
  ]);
  for (const r of [route, stop, links, shapes, fares, stopUse, siblings]) if (r?.error) throw new Error(r.error.message);

  return {
    report,
    inspection: {
      today: todayInManila(),
      report,
      route: route?.data ?? null,
      routeStops: (links?.data ?? []).map((l) => ({ direction: l.direction, stop_order: l.stop_order, name: (l.stops as unknown as { name: string } | null)?.name ?? "Unknown stop" })),
      shapes: shapes?.data ?? [],
      fares: fares?.data ?? [],
      stop: stop?.data ?? null,
      stopRouteCount: new Set((stopUse?.data ?? []).map((x) => x.route_id)).size,
      otherOpenReports: siblings?.count ?? 0,
    },
  };
}

/** Everything the data-quality page needs, read as an administrator. */
export async function loadQuality(supabase: AdminClient): Promise<QualityInput> {
  const [routes, routeStops, shapes, fares, stops] = await Promise.all([
    fetchAll<QualityInput["routes"][number]>((a, b) => supabase.from("routes").select("id, name, code, status, verification_status, last_verified_at, is_sample").order("id").range(a, b)),
    fetchAll<QualityInput["routeStops"][number]>((a, b) => supabase.from("route_stops").select("route_id, direction, stop_order").order("route_id").order("direction").order("stop_order").range(a, b)),
    fetchAll<QualityInput["shapes"][number]>((a, b) => supabase.from("route_shapes").select("route_id, direction, verification_status").order("id").range(a, b)),
    fetchAll<QualityInput["fares"][number]>((a, b) => supabase.from("fare_rules").select("route_id, effective_from, effective_until, verification_status, verified_at").order("id").range(a, b)),
    fetchAll<QualityInput["stops"][number]>((a, b) => supabase.from("stops").select("id, name, latitude, longitude, verification_status, last_verified_at, is_sample").order("id").range(a, b)),
  ]);
  return { now: new Date(), today: todayInManila(), routes, routeStops, shapes, fares, stops };
}
