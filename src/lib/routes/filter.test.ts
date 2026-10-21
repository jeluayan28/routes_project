import { describe, expect, it } from "vitest";
import { SAMPLE_ROUTES } from "@/dev-fixtures/sample-routes";
import { filterRoutes, routeEndpoints } from "./filter";

const BOTH = ["jeepney", "multicab"] as const;

describe("filterRoutes", () => {
  it("returns everything for both types and an empty query", () => {
    expect(filterRoutes(SAMPLE_ROUTES, { query: "", types: BOTH })).toHaveLength(SAMPLE_ROUTES.length);
  });

  it("filters by vehicle type", () => {
    const multicab = filterRoutes(SAMPLE_ROUTES, { query: "", types: ["multicab"] });
    expect(multicab.map((r) => r.id)).toEqual(["sample-c", "sample-d"]);
    const jeepney = filterRoutes(SAMPLE_ROUTES, { query: "", types: ["jeepney"] });
    expect(jeepney.map((r) => r.id)).toEqual(["sample-a", "sample-b"]);
  });

  it("returns nothing when no type is selected", () => {
    expect(filterRoutes(SAMPLE_ROUTES, { query: "", types: [] })).toEqual([]);
  });

  it("matches code, name, and stop names case-insensitively", () => {
    expect(filterRoutes(SAMPLE_ROUTES, { query: "  route b ", types: BOTH }).map((r) => r.id)).toEqual(["sample-b"]);
    expect(filterRoutes(SAMPLE_ROUTES, { query: "stop c2", types: BOTH })[0].id).toBe("sample-c");
    expect(filterRoutes(SAMPLE_ROUTES, { query: "nowhere", types: BOTH })).toEqual([]);
  });

  it("matches stops that exist only in the inbound direction", () => {
    expect(filterRoutes(SAMPLE_ROUTES, { query: "inbound only", types: BOTH }).map((r) => r.id)).toEqual(["sample-a"]);
  });
});

describe("routeEndpoints", () => {
  it("uses the outbound direction", () => {
    expect(routeEndpoints(SAMPLE_ROUTES[0])).toEqual({ start: "Sample Stop A1", end: "Sample Stop A4" });
  });
});
