import { describe, expect, it } from "vitest";
import { SAMPLE_ROUTES } from "@/lib/data/sample-routes";
import { filterRoutes } from "./filter";

const BOTH = ["jeepney", "multicab"] as const;

describe("filterRoutes", () => {
  it("returns everything for both types and an empty query", () => {
    expect(filterRoutes(SAMPLE_ROUTES, { query: "", types: BOTH })).toHaveLength(3);
  });

  it("filters by vehicle type", () => {
    const result = filterRoutes(SAMPLE_ROUTES, { query: "", types: ["multicab"] });
    expect(result.map((r) => r.id)).toEqual(["sample-c"]);
  });

  it("returns nothing when no type is selected", () => {
    expect(filterRoutes(SAMPLE_ROUTES, { query: "", types: [] })).toEqual([]);
  });

  it("matches code, name, and stop names case-insensitively", () => {
    expect(filterRoutes(SAMPLE_ROUTES, { query: "  route b ", types: BOTH })).toHaveLength(1);
    expect(filterRoutes(SAMPLE_ROUTES, { query: "stop c2", types: BOTH })[0].id).toBe("sample-c");
    expect(filterRoutes(SAMPLE_ROUTES, { query: "nowhere", types: BOTH })).toEqual([]);
  });
});
