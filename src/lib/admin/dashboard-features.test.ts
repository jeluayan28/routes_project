import { describe, expect, it } from "vitest";
import { AUDIT_ENTITIES, describeAudit, type AuditEntry } from "@/lib/admin/audit";
import { computeDashboard, type DashboardInput } from "@/lib/admin/dashboard";
import { findOverlap } from "@/lib/admin/fare-form";
import { DUPLICATE_RADIUS_METERS, boundingBox, findNearbyStops, possibleDuplicates } from "@/lib/admin/nearby";
import { paginate, parsePage } from "@/lib/admin/pagination";
import { REPORT_STATUSES, REPORT_STATUS_LABEL, isOpenReport, parseReportStatus } from "@/lib/admin/reports";
import { draftToRoute, type RouteDraft } from "@/lib/admin/route-form";

const NOW = new Date("2026-06-01T00:00:00Z");
const route = (id: string, over: Partial<DashboardInput["routes"][number]> = {}): DashboardInput["routes"][number] => ({
  id, status: "active", verification_status: "verified", last_verified_at: "2026-05-01T00:00:00Z", is_sample: false, ...over,
});
const stop = (id: string, over: Partial<DashboardInput["stops"][number]> = {}): DashboardInput["stops"][number] => ({
  id, latitude: 8.95, longitude: 125.54, verification_status: "verified", last_verified_at: "2026-05-01T00:00:00Z", is_sample: false, ...over,
});
const fare = (route_id: string, over: Partial<DashboardInput["fares"][number]> = {}): DashboardInput["fares"][number] => ({
  route_id, verification_status: "verified", verified_at: "2026-05-01T00:00:00Z", ...over,
});
const input = (over: Partial<DashboardInput> = {}): DashboardInput => ({
  now: NOW, routes: [], routeIdsWithFares: [], openReportRouteIds: [], stops: [], shapes: [], fares: [], ...over,
});

describe("dashboard counts", () => {
  it("counts active routes, draft routes, verified stops, fares to verify and pending reports", () => {
    const d = computeDashboard(
      input({
        routes: [route("a"), route("b"), route("c", { status: "draft", verification_status: "unverified", last_verified_at: null }), route("d", { status: "inactive" })],
        stops: [stop("s1"), stop("s2", { verification_status: "unverified" }), stop("s3", { verification_status: "outdated" })],
        fares: [fare("a"), fare("a", { verification_status: "unverified", verified_at: null }), fare("b", { verification_status: "outdated" })],
        pendingReports: 3,
      }),
    );
    expect(d.counts).toEqual({ activeRoutes: 2, draftRoutes: 1, verifiedStops: 1, faresNeedingVerification: 2, pendingReports: 3 });
    expect(d.fareReviewRoutes.sort()).toEqual(["a", "b"]);
  });

  it("counts a verified fare as needing verification once it is stale", () => {
    const d = computeDashboard(input({ routes: [route("a")], fares: [fare("a", { verified_at: "2025-01-01T00:00:00Z" })] }));
    expect(d.counts.faresNeedingVerification).toBe(1);
  });

  it("never counts sample records", () => {
    const d = computeDashboard(
      input({
        routes: [route("s", { is_sample: true }), route("r")],
        stops: [stop("x", { is_sample: true })],
        fares: [fare("s", { verification_status: "unverified", verified_at: null })],
      }),
    );
    expect(d.counts).toMatchObject({ activeRoutes: 1, verifiedStops: 0, faresNeedingVerification: 0, pendingReports: 0 });
  });
});

const entry = (over: Partial<AuditEntry>): AuditEntry => ({
  id: 1, admin_id: "u1", entity_type: "routes", entity_id: "e1", action: "update", changes: {}, previous: {}, created_at: "2026-06-01T00:00:00Z", ...over,
});

describe("audit descriptions", () => {
  const d = (over: Partial<AuditEntry>) => describeAudit(entry(over));

  it("names route changes, deactivations and approvals", () => {
    expect(d({ action: "insert", changes: { name: "R" } })).toMatchObject({ label: "Route created", subject: "R", significant: true });
    expect(d({ changes: { status: "inactive" }, previous: { status: "active" } }).label).toBe("Route deactivated");
    expect(d({ changes: { status: "active" }, previous: { status: "draft" } }).label).toBe("Route activated");
    expect(d({ changes: { verification_status: "verified" }, previous: { verification_status: "unverified" } }).label).toBe("Route verified");
    expect(d({ changes: { verification_status: "outdated" }, previous: { verification_status: "verified" } }).label).toBe("Route marked outdated");
    expect(d({ changes: { name: "New" }, previous: { name: "Old" } }).label).toBe("Route edited");
    expect(d({ entity_type: "route_verifications", action: "insert" }).label).toBe("Route approved (verified)");
  });

  it("names fare updates with the old and new price", () => {
    expect(d({ entity_type: "fare_rules", action: "insert", changes: { amount: 12 } }).label).toBe("Fare added (₱12.00)");
    expect(d({ entity_type: "fare_rules", changes: { amount: 13 }, previous: { amount: 12 } }).label).toBe("Fare price changed (₱12.00 to ₱13.00)");
    expect(d({ entity_type: "fare_rules", changes: { effective_until: "2026-06-30" }, previous: { effective_until: null } }).label).toBe("Fare ended on 2026-06-30");
    expect(d({ entity_type: "fare_rules", action: "delete" }).label).toBe("Fare deleted");
  });

  it("names report triage, and marks other records as not significant", () => {
    expect(d({ entity_type: "route_reports", changes: { status: "resolved" }, previous: { status: "new" } }).label).toBe("Report marked resolved");
    expect(d({ entity_type: "route_reports", changes: { status: "reviewing" }, previous: { status: "new" } }).label).toBe("Report marked reviewing");
    expect(d({ entity_type: "stops", action: "insert" })).toMatchObject({ label: "Stop created", significant: false });
  });

  it("copes with missing detail", () => {
    expect(d({ changes: null, previous: null }).label).toBe("Route edited");
    expect(d({ entity_type: "fare_rules", changes: { amount: "oops" }, previous: { amount: 12 } }).label).toContain("unknown");
  });

  it("lists every audited kind of record for filtering", () => {
    expect(AUDIT_ENTITIES.map(([k]) => k)).toEqual(expect.arrayContaining(["routes", "fare_rules", "route_reports", "route_verifications"]));
  });
});

describe("reports", () => {
  it("shows the four workflow states under their administrator names", () => {
    expect(REPORT_STATUSES.map((s) => REPORT_STATUS_LABEL[s])).toEqual(["Pending", "Reviewing", "Resolved", "Rejected"]);
  });
  it("treats pending and reviewed as open", () => {
    expect(REPORT_STATUSES.filter(isOpenReport)).toEqual(["new", "reviewing"]);
  });
  it("only accepts real statuses from the URL", () => {
    expect(parseReportStatus("resolved")).toBe("resolved");
    expect(parseReportStatus("open")).toBeNull();
    expect(parseReportStatus(undefined)).toBeNull();
    expect(parseReportStatus("<script>")).toBeNull();
  });
});

describe("pagination", () => {
  const items = Array.from({ length: 60 }, (_, i) => i);
  it("slices pages and reports the range", () => {
    expect(paginate(items, 1, 25)).toMatchObject({ page: 1, pageCount: 3, from: 1, to: 25, total: 60 });
    expect(paginate(items, 3, 25)).toMatchObject({ from: 51, to: 60, items: items.slice(50) });
  });
  it("clamps a page past the end and handles an empty list", () => {
    expect(paginate(items, 99, 25).page).toBe(3);
    expect(paginate([], 4)).toMatchObject({ page: 1, pageCount: 1, from: 0, to: 0, items: [] });
  });
  it("treats unusable page numbers as 1", () => {
    for (const v of [undefined, "", "0", "-2", "1.5", "abc", "999999999"]) expect(parsePage(v)).toBe(1);
    expect(parsePage("4")).toBe(4);
  });
});

describe("nearby stops and duplicates", () => {
  const here = { lat: 8.95, lng: 125.54 };
  const at = (id: string, dLat: number) => ({ id, name: id, latitude: here.lat + dLat, longitude: here.lng });
  const stops = [at("far", 0.01), at("close", 0.0005), at("same", 0.00005), at("mid", 0.0012)];

  it("lists stops within the radius, nearest first", () => {
    const near = findNearbyStops(stops, here);
    expect(near.map((s) => s.id)).toEqual(["same", "close", "mid"]);
    expect(near[0].meters).toBeLessThanOrEqual(DUPLICATE_RADIUS_METERS);
  });
  it("flags only the very close ones as possible duplicates", () => {
    expect(possibleDuplicates(findNearbyStops(stops, here)).map((s) => s.id)).toEqual(["same"]);
  });
  it("gives a bounding box that contains the radius", () => {
    const box = boundingBox(here, 150);
    expect(box.minLat).toBeLessThan(here.lat - 0.001);
    expect(box.maxLng).toBeGreaterThan(here.lng + 0.001);
  });
});

describe("fare overlap check", () => {
  const existing = [{ id: "f1", from_stop_id: null, to_stop_id: null, passenger_type: "regular", effective_from: "2026-01-01", effective_until: "2026-06-30" }];
  const base = { id: null, fromStopId: null, toStopId: null, passengerType: "regular" as const, effectiveFrom: "2026-06-30", effectiveUntil: "" };
  it("finds an overlapping fare for the same slot", () => {
    expect(findOverlap(existing, base)?.id).toBe("f1");
  });
  it("allows back-to-back periods, other categories, other stops, and editing itself", () => {
    expect(findOverlap(existing, { ...base, effectiveFrom: "2026-07-01" })).toBeNull();
    expect(findOverlap(existing, { ...base, passengerType: "student" })).toBeNull();
    expect(findOverlap(existing, { ...base, fromStopId: "a", toStopId: "b" })).toBeNull();
    expect(findOverlap(existing, { ...base, id: "f1" })).toBeNull();
  });
});

describe("route preview model", () => {
  const draft: RouteDraft = {
    code: "", name: "Test route", transportType: "jeepney", description: "", originLabel: "", destinationLabel: "",
    directions: [{ kind: "outbound", stops: [{ stopId: "a", boarding: null, dropoff: false }, { stopId: "gone", boarding: null, dropoff: null }], lines: [[{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }]], geometrySource: "" }],
  };
  const stops = { a: { id: "a", name: "A", latitude: 1, longitude: 1, status: "unverified" as const } };

  it("builds the public route from the draft, skipping unknown stops", () => {
    const r = draftToRoute(draft, stops, { id: "r1", status: "unverified" });
    expect(r).toMatchObject({ id: "r1", code: "Test route", direction: "one-way", fares: [] });
    expect(r.directions[0].stops).toEqual([{ id: "a", name: "A", position: { lat: 1, lng: 1 }, status: "unverified", canBoard: true, canAlight: false }]);
    expect(r.directions[0].paths).toHaveLength(1);
  });

  it("does not invent geometry from stops", () => {
    const r = draftToRoute({ ...draft, directions: [{ ...draft.directions[0], lines: [] }] }, stops, { id: "r1", status: "unverified" });
    expect(r.directions[0].paths).toEqual([]);
  });
});
