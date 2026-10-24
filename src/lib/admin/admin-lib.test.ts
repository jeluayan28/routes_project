import { describe, expect, it } from "vitest";
import { VERIFICATION_STALE_AFTER_DAYS } from "@/lib/constants";
import { computeDashboard, isStale, publicStatus, type DashboardInput } from "./dashboard";
import { fareInputSchema } from "./fare-form";
import {
  draftWarnings,
  linesToGeoJSON,
  linesToText,
  moveItem,
  parseCoordinatePair,
  parseGeometryText,
  routeDraftSchema,
  toSaveRoutePayload,
} from "./route-form";
import { VERIFICATION_CHECKS, todayInManila, verificationInputSchema } from "./verification";

const NOW = new Date("2026-06-01T00:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

describe("computeDashboard", () => {
  const route = (id: string, over: Partial<DashboardInput["routes"][number]> = {}) => ({
    id, status: "active" as const, verification_status: "verified" as const, last_verified_at: daysAgo(10), is_sample: false, ...over,
  });
  const input = (over: Partial<DashboardInput> = {}): DashboardInput => ({
    now: NOW, routes: [], routeIdsWithFares: [], openReportRouteIds: [], stops: [], shapes: [], fares: [], ...over,
  });

  it("counts draft, verified and needs-review routes", () => {
    const d = computeDashboard(input({
      routes: [
        route("draft", { status: "draft", verification_status: "unverified", last_verified_at: null }),
        route("ok"),
        route("old", { last_verified_at: daysAgo(VERIFICATION_STALE_AFTER_DAYS + 1) }),
        route("outdated", { verification_status: "outdated" }),
        route("active-unv", { verification_status: "unverified", last_verified_at: null }),
        route("reported"),
        route("inactive-unv", { status: "inactive", verification_status: "unverified", last_verified_at: null }),
      ],
      openReportRouteIds: ["reported"],
    }));
    expect(d.draft).toEqual(["draft"]);
    expect(d.verified.sort()).toEqual(["ok", "reported"]);
    expect(Object.fromEntries(d.needsReview.map((r) => [r.id, r.reasons]))).toEqual({
      old: ["stale"], outdated: ["outdated"], "active-unv": ["active-unverified"], reported: ["open-report"],
    });
    expect(d.outdated.routes.sort()).toEqual(["old", "outdated"]);
  });

  it("never lists drafts as needing review", () => {
    const d = computeDashboard(input({ routes: [route("d", { status: "draft", verification_status: "unverified", last_verified_at: null })], openReportRouteIds: ["d"] }));
    expect(d.needsReview).toEqual([]);
  });

  it("treats the stale boundary exactly", () => {
    expect(isStale(daysAgo(VERIFICATION_STALE_AFTER_DAYS), NOW)).toBe(false);
    expect(isStale(daysAgo(VERIFICATION_STALE_AFTER_DAYS + 1), NOW)).toBe(true);
    expect(isStale(null, NOW)).toBe(false);
  });

  it("finds routes with no fare records", () => {
    const d = computeDashboard(input({ routes: [route("a"), route("b")], routeIdsWithFares: ["a"] }));
    expect(d.missingFares).toEqual(["b"]);
  });

  it("flags placeholder, out-of-area and invalid stop coordinates", () => {
    const stop = (id: string, latitude: number, longitude: number) => ({ id, latitude, longitude, verification_status: "verified" as const, last_verified_at: daysAgo(1), is_sample: false });
    const d = computeDashboard(input({ stops: [stop("ok", 8.95, 125.54), stop("zero", 0, 0), stop("far", 14.6, 121), stop("nan", NaN, 125.5)] }));
    expect(d.suspectStops).toEqual([
      { id: "zero", reason: "placeholder" }, { id: "far", reason: "outside-area" }, { id: "nan", reason: "invalid" },
    ]);
  });

  it("counts outdated stops, shapes and fares", () => {
    const d = computeDashboard(input({
      stops: [{ id: "s", latitude: 8.95, longitude: 125.54, verification_status: "outdated", last_verified_at: null, is_sample: false }],
      shapes: [{ route_id: "r", verification_status: "verified", last_verified_at: daysAgo(400) }, { route_id: "r", verification_status: "verified", last_verified_at: daysAgo(1) }],
      fares: [{ route_id: "r", verification_status: "outdated", verified_at: null }],
    }));
    expect(d.outdated).toMatchObject({ stops: ["s"], shapes: 1, fares: 1 });
  });

  it("keeps sample data out of every list", () => {
    const d = computeDashboard(input({
      routes: [route("s", { is_sample: true, status: "draft", verification_status: "unverified" })],
      stops: [{ id: "x", latitude: 0, longitude: 0, verification_status: "unverified", last_verified_at: null, is_sample: true }],
    }));
    expect(d).toMatchObject({ draft: [], missingFares: [], suspectStops: [], totals: { routes: 0, stops: 0, sampleRoutes: 1 } });
  });
});

describe("publicStatus", () => {
  const base = { status: "active" as const, verification_status: "verified" as const, last_verified_at: daysAgo(1), is_sample: false };
  it("is public only when active and verified", () => {
    expect(publicStatus(base, NOW).public).toBe(true);
    expect(publicStatus({ ...base, status: "draft" }, NOW)).toMatchObject({ public: false, reason: expect.stringContaining("draft") });
    expect(publicStatus({ ...base, status: "inactive" }, NOW).public).toBe(false);
    expect(publicStatus({ ...base, verification_status: "unverified" }, NOW).public).toBe(false);
    expect(publicStatus({ ...base, verification_status: "outdated" }, NOW).public).toBe(false);
  });
  it("never publishes samples, and warns about stale verification", () => {
    expect(publicStatus({ ...base, is_sample: true }, NOW).public).toBe(false);
    const stale = publicStatus({ ...base, last_verified_at: daysAgo(500) }, NOW);
    expect(stale.public).toBe(true);
    expect(stale.reason).toMatch(/Re-verify/);
  });
});

describe("route draft validation", () => {
  const U = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
  const draft = (over: Record<string, unknown> = {}) => ({
    code: "", name: "Test Route", transportType: "minibus", description: "", originLabel: "A", destinationLabel: "B",
    directions: [{ kind: "outbound", stops: [{ stopId: U(1), boarding: null, dropoff: null }, { stopId: U(2), boarding: null, dropoff: null }], lines: [], geometrySource: "" }],
    ...over,
  });
  const issues = (d: unknown) => {
    const r = routeDraftSchema.safeParse(d);
    return r.success ? [] : r.error.issues.map((i) => i.message);
  };

  it("accepts a valid draft and trims text", () => {
    const r = routeDraftSchema.parse(draft({ name: "  Spaced  " }));
    expect(r.name).toBe("Spaced");
  });

  it("requires a name and a real transport type", () => {
    expect(issues(draft({ name: "  " }))).toContain("Give the route a name.");
    expect(issues(draft({ transportType: "tricycle" }))).not.toEqual([]);
  });

  it("requires outbound, forbids a repeated direction, and a stop twice in one direction", () => {
    const inboundOnly = [{ kind: "inbound", stops: [], lines: [], geometrySource: "" }];
    expect(issues(draft({ directions: inboundOnly }))).toContain("A route needs an outbound direction.");
    const twice = [draft().directions[0], draft().directions[0]];
    expect(issues(draft({ directions: twice }))).toContain("A direction can only be listed once.");
    const dup = [{ kind: "outbound", stops: [{ stopId: U(1), boarding: null, dropoff: null }, { stopId: U(1), boarding: null, dropoff: null }], lines: [], geometrySource: "" }];
    expect(issues(draft({ directions: dup }))[0]).toMatch(/only once in the outbound direction/);
  });

  it("allows the same stop in both directions (separate lists)", () => {
    const both = [draft().directions[0], { ...draft().directions[0], kind: "inbound" }];
    expect(issues(draft({ directions: both }))).toEqual([]);
  });

  it("rejects non-UUID stops and out-of-range or too-short geometry", () => {
    const d = (stops: unknown, lines: unknown) => draft({ directions: [{ kind: "outbound", stops, lines, geometrySource: "" }] });
    expect(issues(d([{ stopId: "nope", boarding: null, dropoff: null }], []))).not.toEqual([]);
    expect(issues(d([], [[{ lat: 91, lng: 125 }, { lat: 8, lng: 125 }]]))).not.toEqual([]);
    expect(issues(d([], [[{ lat: 8, lng: 125 }]]))).toContain("A line needs at least two points.");
  });

  it("builds the save payload with GeoJSON in [lng, lat] order, rounded", () => {
    const parsed = routeDraftSchema.parse(draft({
      directions: [{ kind: "outbound", stops: [{ stopId: U(1), boarding: false, dropoff: null }], lines: [[{ lat: 8.95123456789, lng: 125.5 }, { lat: 8.96, lng: 125.51 }]], geometrySource: "survey" }],
    }));
    const p = toSaveRoutePayload(parsed);
    expect(p.directions[0]).toEqual({
      direction: "outbound",
      stops: [{ stop_id: U(1), boarding_allowed: false, dropoff_allowed: null }],
      geometry: { type: "LineString", coordinates: [[125.5, 8.951235], [125.51, 8.96]] },
      geometry_source: "survey",
    });
    expect(linesToGeoJSON([])).toBeNull();
    expect(linesToGeoJSON([[{ lat: 1, lng: 2 }, { lat: 3, lng: 4 }], [{ lat: 5, lng: 6 }, { lat: 7, lng: 8 }]])!.type).toBe("MultiLineString");
  });

  it("warns, without blocking, about thin or unsourced content", () => {
    const w = draftWarnings(routeDraftSchema.parse(draft({ originLabel: "" })));
    expect(w.join(" ")).toMatch(/No geometry is recorded for the outbound/);
    expect(w.join(" ")).toMatch(/starting and ending points/);
    const lone = draftWarnings(routeDraftSchema.parse(draft({ directions: [{ kind: "outbound", stops: [], lines: [[{ lat: 0.1, lng: 0.1 }, { lat: 0.2, lng: 0.2 }]], geometrySource: "" }] })));
    expect(lone.join(" ")).toMatch(/fewer than two stops/);
    expect(lone.join(" ")).toMatch(/outside the Butuan City area/);
    expect(lone.join(" ")).toMatch(/source/);
  });
});

describe("moveItem", () => {
  it("moves up, down, and clamps", () => {
    expect(moveItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(moveItem(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
    expect(moveItem(["a", "b", "c"], 0, -5)).toEqual(["a", "b", "c"]);
    expect(moveItem(["a", "b", "c"], 0, 99)).toEqual(["b", "c", "a"]);
    expect(moveItem(["a"], 5, 0)).toEqual(["a"]);
  });
  it("does not mutate its input", () => {
    const a = ["a", "b"];
    moveItem(a, 0, 1);
    expect(a).toEqual(["a", "b"]);
  });
});

describe("parseCoordinatePair", () => {
  it("accepts valid decimal degrees", () => {
    expect(parseCoordinatePair("8.95", "125.54")).toEqual({ ok: true, coordinate: { lat: 8.95, lng: 125.54 } });
  });
  it("explains each problem", () => {
    expect(parseCoordinatePair("91", "125")).toMatchObject({ ok: false, errors: { latitude: expect.stringContaining("outside") } });
    expect(parseCoordinatePair("8", "abc")).toMatchObject({ ok: false, errors: { longitude: expect.stringContaining("not a decimal") } });
    expect(parseCoordinatePair("", "")).toMatchObject({ ok: false, errors: { latitude: expect.any(String), longitude: expect.any(String) } });
    expect(parseCoordinatePair("0", "0")).toMatchObject({ ok: false, errors: { both: expect.stringContaining("placeholder") } });
  });
  it("warns, but accepts, a point outside Butuan (probably swapped values)", () => {
    expect(parseCoordinatePair("125.54", "8.95")).toMatchObject({ ok: false }); // 125 is not a valid latitude
    expect(parseCoordinatePair("14.6", "121")).toMatchObject({ ok: true, warning: expect.stringContaining("outside") });
  });
});

describe("parseGeometryText", () => {
  it("treats blank input as no geometry", () => {
    expect(parseGeometryText("  \n ")).toEqual({ ok: true, lines: [], warnings: [] });
  });

  it("reads latitude, longitude lines, with blank lines separating lines", () => {
    const r = parseGeometryText("8.95, 125.54\n8.96 125.55\n\n8.97;125.56\n8.98,125.57");
    expect(r).toMatchObject({ ok: true });
    if (r.ok) expect(r.lines).toEqual([
      [{ lat: 8.95, lng: 125.54 }, { lat: 8.96, lng: 125.55 }],
      [{ lat: 8.97, lng: 125.56 }, { lat: 8.98, lng: 125.57 }],
    ]);
  });

  it("reports each bad line with its number", () => {
    const r = parseGeometryText("8.95, 125.54\nnot,numbers\n8.96\n95, 125.5\n8.97, 125.56");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toHaveLength(3);
      expect(r.errors[0]).toMatch(/^Line 2:/);
      expect(r.errors[1]).toMatch(/^Line 3: expected "latitude, longitude" but found 1 value/);
      expect(r.errors[2]).toMatch(/^Line 4:.*outside -90 to 90/);
    }
  });

  it("requires at least two points per line", () => {
    expect(parseGeometryText("8.95, 125.54").ok).toBe(false);
    expect(parseGeometryText("8.95, 125.54\n8.96, 125.55\n\n8.97, 125.56").ok).toBe(false);
  });

  it("reads GeoJSON LineString, MultiLineString and Feature, in [lng, lat] order", () => {
    const ls = parseGeometryText('{"type":"LineString","coordinates":[[125.54,8.95],[125.55,8.96]]}');
    expect(ls).toMatchObject({ ok: true, lines: [[{ lat: 8.95, lng: 125.54 }, { lat: 8.96, lng: 125.55 }]] });
    expect(parseGeometryText('{"type":"Feature","geometry":{"type":"MultiLineString","coordinates":[[[125.5,8.9],[125.6,8.9]],[[125.7,8.9],[125.8,8.9]]]}}')).toMatchObject({ ok: true });
  });

  it("rejects bad or unsupported GeoJSON rather than guessing", () => {
    expect(parseGeometryText('{"type":"Point","coordinates":[1,2]}').ok).toBe(false);
    expect(parseGeometryText('{"type":"LineString","coordinates":[[125.5,95],[125.6,8.9]]}').ok).toBe(false);
    expect(parseGeometryText('{"type": ').ok).toBe(false);
  });

  it("warns about points outside the area", () => {
    const r = parseGeometryText("14.6, 121.0\n14.7, 121.1");
    expect(r).toMatchObject({ ok: true, warnings: [expect.stringContaining("outside")] });
  });

  it("round-trips through linesToText", () => {
    const r = parseGeometryText("8.95, 125.54\n8.96, 125.55\n\n8.97, 125.56\n8.98, 125.57");
    if (!r.ok) throw new Error("parse failed");
    expect(parseGeometryText(linesToText(r.lines))).toEqual(r);
  });
});

describe("fareInputSchema", () => {
  const U1 = "00000000-0000-4000-8000-000000000001";
  const U2 = "00000000-0000-4000-8000-000000000002";
  const fare = (over: Record<string, unknown> = {}) => ({
    id: null, routeId: U1, fromStopId: null, toStopId: null, passengerType: "regular", amount: "10",
    effectiveFrom: "2026-01-01", effectiveUntil: "", source: "", ...over,
  });
  const messages = (v: unknown) => {
    const r = fareInputSchema.safeParse(v);
    return r.success ? [] : r.error.issues.map((i) => i.message);
  };

  it("accepts flat and stop-to-stop fares for each category", () => {
    expect(messages(fare())).toEqual([]);
    expect(messages(fare({ fromStopId: U1, toStopId: U2, passengerType: "student", amount: "8.50", effectiveUntil: "2026-12-31" }))).toEqual([]);
  });

  it.each([["-1"], ["12,50"], ["abc"], ["1e3"], [""], ["12.345"]])("rejects amount %j", (amount) => {
    expect(messages(fare({ amount })).length).toBeGreaterThan(0);
  });

  it("requires both stops or neither, and different stops", () => {
    expect(messages(fare({ fromStopId: U1 }))[0]).toMatch(/both an origin and a destination/);
    expect(messages(fare({ fromStopId: U1, toStopId: U1 }))[0]).toMatch(/must be different/);
  });

  it("validates dates and their order", () => {
    expect(messages(fare({ effectiveFrom: "2026-02-30" })).length).toBeGreaterThan(0);
    expect(messages(fare({ effectiveFrom: "2026-06-01", effectiveUntil: "2026-05-01" }))[0]).toMatch(/before the start/);
  });

  it("rejects an unknown passenger category", () => {
    expect(messages(fare({ passengerType: "vip" })).length).toBeGreaterThan(0);
  });
});

describe("verification input", () => {
  const allChecks = Object.fromEntries(VERIFICATION_CHECKS.map((c) => [c.key, true]));
  const input = (over: Record<string, unknown> = {}) => ({
    routeId: "00000000-0000-4000-8000-000000000001", verifiedOn: "2026-01-15", source: "Fictional survey", notes: "", checks: allChecks, ...over,
  });

  it("lists every aspect an administrator must confirm", () => {
    expect(VERIFICATION_CHECKS.map((c) => c.key)).toEqual([
      "transport_type", "name_direction", "endpoints", "stops", "geometry", "boarding_dropoff", "fares", "passenger_categories",
    ]);
  });

  it("accepts a complete record", () => {
    expect(verificationInputSchema.safeParse(input()).success).toBe(true);
  });

  it.each(VERIFICATION_CHECKS.map((c) => c.key))("refuses when %s is not confirmed", (key) => {
    expect(verificationInputSchema.safeParse(input({ checks: { ...allChecks, [key]: false } })).success).toBe(false);
  });

  it("requires a source and a well-formed date", () => {
    expect(verificationInputSchema.safeParse(input({ source: "  " })).success).toBe(false);
    expect(verificationInputSchema.safeParse(input({ verifiedOn: "15/01/2026" })).success).toBe(false);
  });

  it("computes today's date in Asia/Manila, not UTC", () => {
    expect(todayInManila(new Date("2026-03-01T17:00:00Z"))).toBe("2026-03-02"); // 01:00 next day in Manila
    expect(todayInManila(new Date("2026-03-01T15:59:00Z"))).toBe("2026-03-01");
  });
});
