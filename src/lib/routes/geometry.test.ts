import { describe, expect, it } from "vitest";
import { SAMPLE_ROUTES } from "@/dev-fixtures/sample-routes";
import { collectStops, hasGeometry, metersPerPixel, parseLineGeometry, routePoints, routesNearPoint } from "./geometry";

const [A, B, C, D] = SAMPLE_ROUTES;

describe("parseLineGeometry", () => {
  it("swaps GeoJSON [lng, lat] into lat/lng", () => {
    expect(parseLineGeometry({ type: "LineString", coordinates: [[125.5, 8.9], [125.6, 8.95]] })).toEqual([
      [{ lat: 8.9, lng: 125.5 }, { lat: 8.95, lng: 125.6 }],
    ]);
  });

  it("keeps each part of a MultiLineString separate", () => {
    const lines = parseLineGeometry({
      type: "MultiLineString",
      coordinates: [[[125.5, 8.9], [125.51, 8.9]], [[125.6, 8.9], [125.61, 8.9]]],
    });
    expect(lines).toHaveLength(2);
  });

  it.each([
    ["null", null],
    ["a point", { type: "Point", coordinates: [125.5, 8.9] }],
    ["a one-point line", { type: "LineString", coordinates: [[125.5, 8.9]] }],
    ["non-numeric coordinates", { type: "LineString", coordinates: [["a", "b"], [1, 2]] }],
    ["out-of-range latitude", { type: "LineString", coordinates: [[125.5, 95], [125.6, 8.9]] }],
    ["NaN", { type: "LineString", coordinates: [[NaN, 8.9], [125.6, 8.9]] }],
  ])("returns no lines for %s instead of guessing", (_name, input) => {
    expect(parseLineGeometry(input)).toEqual([]);
  });
});

describe("routePoints / hasGeometry", () => {
  it("covers lines and stops of every direction", () => {
    const pts = routePoints(A);
    expect(pts).toContainEqual([8.9462, 125.54]); // inbound-only vertex
    expect(pts).toContainEqual([8.9475, 125.52]);
  });

  it("uses only the stops when no geometry is recorded", () => {
    expect(hasGeometry(D)).toBe(false);
    expect(routePoints(D)).toHaveLength(2);
  });
});

describe("collectStops", () => {
  it("lists a shared stop once, with every route and direction serving it", () => {
    const stops = collectStops([A, B]);
    const shared = stops.filter((s) => s.stop.id === "sa-2");
    expect(shared).toHaveLength(1);
    expect(shared[0].routes.map((l) => l.route.id).sort()).toEqual(["sample-a", "sample-b"]);

    const a1 = stops.find((s) => s.stop.id === "sa-1")!;
    expect(a1.routes[0].directions).toEqual(["outbound", "inbound"]);
  });

  it("reports boarding / drop-off per route", () => {
    const a5 = collectStops([A]).find((s) => s.stop.id === "sa-5")!;
    expect(a5.routes[0]).toMatchObject({ canBoard: false, canAlight: true });
  });
});

describe("routesNearPoint", () => {
  it("finds both routes where they overlap", () => {
    const near = routesNearPoint([A, B, C], { lat: 8.9475, lng: 125.54 }, 20);
    expect(near.map((r) => r.id)).toEqual(["sample-a", "sample-b"]);
  });

  it("finds only the one route away from the overlap", () => {
    expect(routesNearPoint([A, B], { lat: 8.9475, lng: 125.555 }, 20).map((r) => r.id)).toEqual(["sample-a"]);
  });

  it("does not treat the gap in a MultiLineString as road", () => {
    // Midpoint between C's two separate lines.
    expect(routesNearPoint([C], { lat: 8.955, lng: 125.5125 }, 50)).toEqual([]);
  });

  it("never matches a route with no geometry", () => {
    expect(routesNearPoint([D], { lat: 8.94, lng: 125.51 }, 1000)).toEqual([]);
  });
});

describe("metersPerPixel", () => {
  it("halves with each zoom level", () => {
    expect(metersPerPixel(8.9, 14) / metersPerPixel(8.9, 15)).toBeCloseTo(2);
  });
});
