import { describe, expect, it } from "vitest";
import { computeQuality, type QualityInput } from "@/lib/admin/quality";
import { inspectReport, type InspectionInput } from "@/lib/admin/report-inspection";
import { parseStaleDays } from "@/lib/constants";

const NOW = new Date("2026-10-23T00:00:00Z");
const TODAY = "2026-10-23";
const base = (over: Partial<QualityInput> = {}): QualityInput => ({
  now: NOW, today: TODAY, routes: [], routeStops: [], shapes: [], fares: [], stops: [], ...over,
});
const route = (id: string, over: Partial<QualityInput["routes"][number]> = {}): QualityInput["routes"][number] => ({
  id, name: `Route ${id}`, code: null, status: "active", verification_status: "verified", last_verified_at: "2026-10-01T00:00:00Z", is_sample: false, ...over,
});
const stops = (id: string, n: number, direction: "outbound" | "inbound" = "outbound") =>
  Array.from({ length: n }, (_, i) => ({ route_id: id, direction, stop_order: i + 1 }));
const shape = (id: string, direction: "outbound" | "inbound" = "outbound", verification_status: "verified" | "unverified" = "verified") => ({ route_id: id, direction, verification_status });
const fare = (id: string, over: Partial<QualityInput["fares"][number]> = {}): QualityInput["fares"][number] => ({
  route_id: id, effective_from: "2026-01-01", effective_until: null, verification_status: "verified", verified_at: "2026-10-01T00:00:00Z", ...over,
});
const flagsOf = (input: QualityInput, id: string) => computeQuality(input).routes.find((r) => r.id === id)?.flags ?? [];

describe("route quality flags", () => {
  it("flags nothing for a complete, recently verified route", () => {
    const q = computeQuality(base({ routes: [route("a")], routeStops: stops("a", 3), shapes: [shape("a")], fares: [fare("a")] }));
    expect(q.routes).toEqual([]);
  });

  it("flags a route whose geometry is missing or unverified", () => {
    const input = (shapes: QualityInput["shapes"]) => base({ routes: [route("a")], routeStops: stops("a", 3), shapes, fares: [fare("a")] });
    expect(flagsOf(input([]), "a")).toEqual(["no-verified-geometry"]);
    expect(flagsOf(input([shape("a", "outbound", "unverified")]), "a")).toEqual(["no-verified-geometry"]);
  });

  it("needs verified geometry for every direction that has stops", () => {
    const input = base({ routes: [route("a")], routeStops: [...stops("a", 3), ...stops("a", 3, "inbound")], shapes: [shape("a")], fares: [fare("a")] });
    expect(flagsOf(input, "a")).toEqual(["no-verified-geometry"]);
  });

  it("flags missing, too-short and gapped stop sequences", () => {
    const only = (rs: QualityInput["routeStops"]) => base({ routes: [route("a")], routeStops: rs, shapes: [shape("a")], fares: [fare("a")] });
    expect(flagsOf(only([]), "a")).toContain("missing-stop-sequence");
    expect(flagsOf(only(stops("a", 1)), "a")).toContain("missing-stop-sequence");
    expect(flagsOf(only([{ route_id: "a", direction: "outbound", stop_order: 1 }, { route_id: "a", direction: "outbound", stop_order: 3 }]), "a")).toContain("missing-stop-sequence");
    expect(flagsOf(only(stops("a", 2)), "a")).not.toContain("missing-stop-sequence");
  });

  it("flags routes with no fares, and fares that are expired or not yet started", () => {
    const input = (fares: QualityInput["fares"]) => base({ routes: [route("a")], routeStops: stops("a", 3), shapes: [shape("a")], fares });
    expect(flagsOf(input([]), "a")).toEqual(["no-fares"]);
    expect(flagsOf(input([fare("a", { effective_until: "2026-06-30" })]), "a")).toEqual(["fares-expired"]);
    expect(flagsOf(input([fare("a", { effective_from: "2027-01-01" })]), "a")).toEqual(["fares-expired"]);
    expect(flagsOf(input([fare("a", { effective_until: TODAY })]), "a")).toEqual([]);
  });

  it("flags verification older than the threshold, and anything marked outdated", () => {
    const input = (r: Partial<QualityInput["routes"][number]>) => base({ routes: [route("a", r)], routeStops: stops("a", 3), shapes: [shape("a")], fares: [fare("a")] });
    expect(flagsOf(input({ last_verified_at: "2025-01-01T00:00:00Z" }), "a")).toEqual(["stale-verification"]);
    expect(flagsOf(input({ verification_status: "outdated" }), "a")).toEqual(["stale-verification"]);
    expect(flagsOf(input({ last_verified_at: "2026-09-01T00:00:00Z" }), "a")).toEqual([]);
  });

  it("flags a fare whose own verification is out of date", () => {
    const input = base({ routes: [route("a")], routeStops: stops("a", 3), shapes: [shape("a")], fares: [fare("a", { verified_at: "2025-01-01T00:00:00Z" })] });
    expect(flagsOf(input, "a")).toEqual(["stale-fares"]);
  });

  it("never reports sample data", () => {
    const q = computeQuality(base({
      routes: [route("a", { is_sample: true })],
      stops: [{ id: "s", name: "S", latitude: 0, longitude: 0, verification_status: "unverified", last_verified_at: null, is_sample: true }],
    }));
    expect(q).toMatchObject({ routes: [], stops: [] });
  });
});

describe("stop quality flags", () => {
  const stop = (over: Partial<QualityInput["stops"][number]> = {}): QualityInput["stops"][number] => ({
    id: "s", name: "Stop", latitude: 8.95, longitude: 125.54, verification_status: "verified", last_verified_at: "2026-10-01T00:00:00Z", is_sample: false, ...over,
  });
  const flags = (s: QualityInput["stops"][number]) => computeQuality(base({ stops: [s] })).stops[0]?.flags ?? [];

  it("accepts a verified stop inside Butuan", () => expect(flags(stop())).toEqual([]));
  it("flags unverified, placeholder, outside-area and invalid coordinates", () => {
    expect(flags(stop({ verification_status: "unverified" }))).toEqual(["unverified-coordinates"]);
    expect(flags(stop({ latitude: 0, longitude: 0 }))).toEqual(["unverified-coordinates"]);
    expect(flags(stop({ latitude: 14.6, longitude: 121 }))).toEqual(["unverified-coordinates"]);
    expect(flags(stop({ latitude: Number.NaN }))).toEqual(["unverified-coordinates"]);
  });
  it("flags a stop verified too long ago", () => expect(flags(stop({ last_verified_at: "2025-01-01T00:00:00Z" }))).toEqual(["stale-verification"]));
});

describe("stale threshold setting", () => {
  it("uses a whole number of days from 1 to 3650 and falls back to 180 otherwise", () => {
    expect(parseStaleDays("90")).toBe(90);
    for (const bad of [undefined, "", "  ", "0", "-5", "abc", "1.5", "99999"]) expect(parseStaleDays(bad)).toBe(180);
  });
});

describe("report inspection", () => {
  const input = (over: Partial<InspectionInput> = {}): InspectionInput => ({
    today: TODAY, report: { report_type: "incorrect_fare", direction: null, route_id: "r", stop_id: null }, route: null, routeStops: [], shapes: [], fares: [], stop: null, stopRouteCount: 0, otherOpenReports: 0, ...over,
  });
  const routeRec: NonNullable<InspectionInput["route"]> = { id: "r", name: "Rizal", code: "R1", status: "active", verification_status: "verified", last_verified_at: "2026-10-01T00:00:00Z", is_sample: false, deactivation_reason: null };

  it("shows the current record next to the claim, with links to the editors", () => {
    const i = inspectReport(input({ route: routeRec, fares: [{ passenger_type: "regular", amount: 13, effective_from: "2026-01-01", effective_until: null, verification_status: "verified", source_description: "LTFRB", from_stop_id: null }] }));
    expect(i.facts.map((f) => f.label)).toContain("Regular fare");
    expect(i.facts.find((f) => f.label === "Regular fare")?.value).toContain("LTFRB");
    expect(i.links.map((l) => l.href)).toContain("/admin/routes/r?tab=fares");
  });

  it("warns when the route is gone, or other reports agree", () => {
    expect(inspectReport(input()).concerns[0]).toMatch(/no longer exists/);
    expect(inspectReport(input({ route: routeRec, otherOpenReports: 2 })).concerns.join(" ")).toMatch(/2 other open reports/);
  });

  it("warns that a report with no subject cannot be inspected", () => {
    expect(inspectReport(input({ report: { report_type: "other", direction: null, route_id: null, stop_id: null } })).concerns[0]).toMatch(/point at/);
  });

  it("flags when no fare is in force today", () => {
    const i = inspectReport(input({ route: routeRec }));
    expect(i.facts.find((f) => f.label === "Fares in force today")).toMatchObject({ warn: true });
  });
});
