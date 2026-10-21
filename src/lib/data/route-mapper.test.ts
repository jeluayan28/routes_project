import { describe, expect, it } from "vitest";
import { buildRoutes, type RouteRow, type ShapeRow } from "./route-mapper";

type Link = RouteRow["route_stops"][number];

const stopRow = (id: string, over: Partial<NonNullable<Link["stops"]>> = {}) => ({
  id,
  name: `Stop ${id}`,
  latitude: 8.95,
  longitude: 125.54,
  pickup_allowed: true,
  dropoff_allowed: true,
  verification_status: "verified" as const,
  ...over,
});

const link = (direction: "outbound" | "inbound", stop_order: number, id: string, over: Partial<Link> = {}): Link => ({
  direction,
  stop_order,
  boarding_allowed: null,
  dropoff_allowed: null,
  stops: stopRow(id),
  ...over,
});

const route = (over: Partial<RouteRow> = {}): RouteRow => ({
  id: "r1",
  code: "R1",
  name: "Route 1",
  transport_type: "jeepney",
  verification_status: "verified",
  route_stops: [],
  ...over,
});

const line = (...pts: [number, number][]) => ({ type: "LineString", coordinates: pts });

describe("buildRoutes", () => {
  it("orders stops by stop_order within each direction", () => {
    const [r] = buildRoutes(
      [route({ route_stops: [link("outbound", 3, "c"), link("outbound", 1, "a"), link("inbound", 1, "z"), link("outbound", 2, "b")] })],
      [],
    );
    expect(r.directions.map((d) => d.kind)).toEqual(["outbound", "inbound"]);
    expect(r.directions[0].stops.map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(r.directions[1].stops.map((s) => s.id)).toEqual(["z"]);
    expect(r.direction).toBe("both");
  });

  it("treats a route with only outbound rows as one-way", () => {
    const [r] = buildRoutes([route({ route_stops: [link("outbound", 1, "a")] })], []);
    expect(r.directions).toHaveLength(1);
    expect(r.direction).toBe("one-way");
  });

  it("lets a per-route override win over the stop default, and NULL follow it", () => {
    const [r] = buildRoutes(
      [
        route({
          route_stops: [
            link("outbound", 1, "a", { boarding_allowed: false }),
            link("outbound", 2, "b", { stops: stopRow("b", { dropoff_allowed: false }) }),
          ],
        }),
      ],
      [],
    );
    const [a, b] = r.directions[0].stops;
    expect(a).toMatchObject({ canBoard: false, canAlight: true });
    expect(b).toMatchObject({ canBoard: true, canAlight: false });
  });

  it("attaches each shape to its own direction", () => {
    const shapes: ShapeRow[] = [
      { route_id: "r1", direction: "outbound", geojson: line([125.5, 8.9], [125.6, 8.9]) },
      { route_id: "r1", direction: "inbound", geojson: line([125.6, 8.91], [125.5, 8.91]) },
      { route_id: "other", direction: "outbound", geojson: line([1, 1], [2, 2]) },
    ];
    const [r] = buildRoutes([route({ route_stops: [link("outbound", 1, "a"), link("inbound", 1, "a")] })], shapes);
    expect(r.directions[0].paths[0][0]).toEqual({ lat: 8.9, lng: 125.5 });
    expect(r.directions[1].paths[0][0]).toEqual({ lat: 8.91, lng: 125.6 });
  });

  it("draws nothing for a malformed shape, and never connects the stops", () => {
    const [r] = buildRoutes(
      [route({ route_stops: [link("outbound", 1, "a"), link("outbound", 2, "b")] })],
      [{ route_id: "r1", direction: "outbound", geojson: { type: "Point", coordinates: [1, 2] } }],
    );
    expect(r.directions[0].stops).toHaveLength(2);
    expect(r.directions[0].paths).toEqual([]);
  });

  it("skips stops the caller cannot see and keeps routes with no stops", () => {
    const [r] = buildRoutes([route({ route_stops: [link("outbound", 1, "a", { stops: null })] })], []);
    expect(r.directions[0].stops).toEqual([]);
  });

  it("maps type and status, and falls back to the name when there is no code", () => {
    const [r] = buildRoutes([route({ code: null, transport_type: "multicab", verification_status: "outdated" })], []);
    expect(r).toMatchObject({ code: "Route 1", vehicleType: "multicab", status: "outdated", fares: [] });
  });
});
