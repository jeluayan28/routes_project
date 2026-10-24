import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const from = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from }) }));

import { buildNetwork } from "@/lib/search/network";
import { searchJourneys } from "@/lib/search/engine";
import { assembleSearchData, loadSearchData, type SearchRows } from "@/lib/search/load";

/** Fictional rows shaped like the database's. */
const rows = (over: Partial<SearchRows> = {}): SearchRows => ({
  routes: [{ id: "R1", code: "F-1", name: "Fixture route", transport_type: "minibus", status: "active", verification_status: "verified", last_verified_at: "2026-05-01T00:00:00Z" }],
  stops: ["A", "B", "C"].map((id, i) => ({
    id, name: `Fixture stop ${id}`, latitude: 0.1, longitude: 0.1 + i * 0.01,
    pickup_allowed: true, dropoff_allowed: true, verification_status: "verified" as const,
  })),
  links: ["A", "B", "C"].map((stop_id, i) => ({ route_id: "R1", direction: "outbound" as const, stop_order: i + 1, boarding_allowed: null, dropoff_allowed: null, stop_id })),
  shapes: [],
  fares: [],
  landmarks: [],
  ...over,
});

describe("assembleSearchData", () => {
  it("follows the stop's boarding and drop-off settings unless the route overrides them", () => {
    const r = rows();
    r.stops[0].pickup_allowed = false; // A: stop says no boarding
    r.links[1].boarding_allowed = false; // B: route override
    r.links[2].dropoff_allowed = false; // C: route override
    r.links[0].boarding_allowed = true; // explicit allow beats the stop's own no
    const [a, b, c] = assembleSearchData(r).network.routes[0].directions[0].stops;
    expect(a).toMatchObject({ canBoard: true, canAlight: true });
    expect(b).toMatchObject({ canBoard: false, canAlight: true });
    expect(c).toMatchObject({ canBoard: true, canAlight: false });
  });

  it("follows the stop when the route has no override", () => {
    const r = rows();
    r.stops[1].pickup_allowed = false;
    expect(assembleSearchData(r).network.routes[0].directions[0].stops[1].canBoard).toBe(false);
  });

  it("keeps outbound and inbound as separate directions, and omits a direction with no stops", () => {
    const r = rows();
    r.links.push({ route_id: "R1", direction: "inbound", stop_order: 1, boarding_allowed: null, dropoff_allowed: null, stop_id: "C" });
    expect(assembleSearchData(r).network.routes[0].directions.map((d) => d.kind)).toEqual(["outbound", "inbound"]);
    expect(assembleSearchData(rows()).network.routes[0].directions.map((d) => d.kind)).toEqual(["outbound"]);
  });

  it("uses geometry only from verified shapes", () => {
    const geojson = { type: "LineString", coordinates: [[0.1, 0.1], [0.11, 0.1]] };
    const ok = assembleSearchData(rows({ shapes: [{ route_id: "R1", direction: "outbound", geojson, verification_status: "verified" }] }));
    expect(ok.network.routes[0].directions[0].geometry).toHaveLength(1);
    const no = assembleSearchData(rows({ shapes: [{ route_id: "R1", direction: "outbound", geojson, verification_status: "unverified" }] }));
    expect(no.network.routes[0].directions[0].geometry).toEqual([]);
  });

  it("hands over a route that is not active as unverified, so it cannot be searched", () => {
    const r = rows();
    r.routes[0].status = "inactive";
    expect(assembleSearchData(r).network.routes[0].status).toBe("unverified");
  });

  it("maps fares, including the status they were stored with", () => {
    const d = assembleSearchData(rows({ fares: [{ id: "F1", currency: "PHP", source_description: "Test source", verified_at: "2026-01-02T00:00:00Z", route_id: "R1", from_stop_id: "A", to_stop_id: "C", passenger_type: "student", amount: 8.5, effective_from: "2026-01-01", effective_until: null, verification_status: "verified" }] }));
    expect(d.network.fares).toEqual([{ id: "F1", currency: "PHP", source: "Test source", verifiedAt: "2026-01-02T00:00:00Z", routeId: "R1", fromStopId: "A", toStopId: "C", category: "student", amount: 8.5, effectiveFrom: "2026-01-01", effectiveUntil: null, status: "verified" }]);
  });

  it("provides stops and landmarks for place lookup", () => {
    const d = assembleSearchData(rows({ landmarks: [{ id: "L1", name: "Fixture Hall", category: "fixture", latitude: 0.2, longitude: 0.2, verification_status: "verified" }] }));
    expect(d.stops.map((s) => s.name)).toEqual(["Fixture stop A", "Fixture stop B", "Fixture stop C"]);
    expect(d.landmarks).toEqual([{ id: "L1", name: "Fixture Hall", category: "fixture", position: { lat: 0.2, lng: 0.2 }, status: "verified" }]);
  });

  it("produces a network the engine can search end to end", () => {
    const d = assembleSearchData(rows({ fares: [{ id: "F2", currency: "PHP", source_description: null, verified_at: null, route_id: "R1", from_stop_id: null, to_stop_id: null, passenger_type: "regular", amount: 10, effective_from: "2026-01-01", effective_until: null, verification_status: "verified" }] }));
    const opts = { passengerCategory: "regular" as const, date: "2026-06-01", acceptStatuses: ["verified"] as const };
    const out = searchJourneys(buildNetwork(d.network, opts), { label: "A", position: d.stops[0].position, stopId: "A" }, { label: "C", position: d.stops[2].position, stopId: "C" }, opts);
    expect(out.status === "ok" && out.journeys[0].fare).toMatchObject({ status: "complete", total: 10 });
  });

  it("excludes a direction whose stop rows were hidden (a gap), rather than guessing", () => {
    const r = rows();
    r.links = r.links.filter((l) => l.stop_id !== "B"); // B was not visible: orders are now 1 and 3
    const opts = { passengerCategory: "regular" as const, date: "2026-06-01", acceptStatuses: ["verified"] as const };
    const net = buildNetwork(assembleSearchData(r).network, opts);
    expect(net.lines).toHaveLength(0);
    expect(net.diagnostics.excludedLines[0].reason).toBe("sequence-gap");
  });
});

/** A query double that answers by table. */
const query = (result: { data: unknown; error: unknown }) => {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "range"]) q[m] = () => q;
  q.then = (resolve: (v: unknown) => unknown) => resolve(result);
  return q;
};
const configured = () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_x");
};

describe("loadSearchData", () => {
  beforeEach(() => {
    from.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns database data, asking only for approved rows", async () => {
    configured();
    const filters: Record<string, string[][]> = {};
    from.mockImplementation((table: string) => {
      const q = query({ data: [], error: null });
      const eq = vi.fn(() => q);
      (q as Record<string, unknown>).eq = (col: string, val: string) => {
        (filters[table] ??= []).push([col, val]);
        return eq();
      };
      return q;
    });
    const result = await loadSearchData();
    expect(result).toMatchObject({ status: "ok", source: "database" });
    expect(filters.routes).toEqual([["status", "active"], ["verification_status", "verified"]]);
    for (const t of ["stops", "route_shapes_geojson", "fare_rules", "landmarks"]) expect(filters[t]).toEqual([["verification_status", "verified"]]);
  });

  it("returns an error, never sample data, when any request fails", async () => {
    configured();
    from.mockImplementation((table: string) => (table === "fare_rules" ? query({ data: null, error: { message: "boom" } }) : query({ data: [], error: null })));
    const result = await loadSearchData();
    expect(result.status).toBe("error");
    expect(JSON.stringify(result)).not.toMatch(/sample/i);
  });

  it("returns an error when the client throws", async () => {
    configured();
    from.mockImplementation(() => {
      throw new Error("network down");
    });
    expect((await loadSearchData()).status).toBe("error");
  });

  it("returns an error when the database is not configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    expect((await loadSearchData()).status).toBe("error");
    expect(from).not.toHaveBeenCalled();
  });

  it("uses the development fixtures only when explicitly enabled, and marks them", async () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_SAMPLE_DATA", "true");
    const result = await loadSearchData();
    expect(result).toMatchObject({ status: "ok", source: "sample" });
    expect(result.status === "ok" && result.data.network.routes.every((r) => r.status === "sample")).toBe(true);
    expect(from).not.toHaveBeenCalled();
  });
});
