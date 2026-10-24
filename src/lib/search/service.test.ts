import { describe, expect, it, vi } from "vitest";
import { GeocoderError, type Geocoder } from "@/lib/search/geocoder";
import type { SearchData } from "@/lib/search/load";
import type { TripParams } from "@/lib/search/params";
import { runTripSearch, type ServiceDeps } from "@/lib/search/service";
import { flatFare, GRID_STOPS, network, route } from "@/lib/search/__fixtures__/fictional";
import type { RawNetwork } from "@/lib/search/types";

const NOW = new Date("2026-06-01T04:00:00Z");

const data = (raw: RawNetwork): SearchData => ({
  network: raw,
  stops: raw.stops.map((s) => ({ id: s.id, name: s.name, position: s.position, status: s.status })),
  landmarks: [{ id: "L1", name: "Fixture Hall", category: "fixture", position: { lat: 0.1, lng: 0.1 + 0.0007 }, status: "verified" }],
});

const params = (over: Partial<TripParams> = {}): TripParams => ({
  from: "Fixture stop A", to: "Fixture stop C", types: ["minibus", "multicab"], category: "regular", maxTransfers: 2, preference: "fewest-transfers", ...over,
});

const deps = (raw: RawNetwork, over: Partial<ServiceDeps> = {}, source: "database" | "sample" = "database"): ServiceDeps => ({
  loadData: async () => ({ status: "ok", source, data: data(raw) }),
  serviceArea: null,
  now: NOW,
  ...over,
});

const base = network([route("R1", ["A", "B", "C"])], [flatFare("R1", 10)]);

describe("a successful search", () => {
  it("resolves both places and returns ranked journeys with the data source", async () => {
    const r = await runTripSearch(params(), deps(base));
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.origin).toMatchObject({ label: "Fixture stop A", source: "stop", fromVerifiedData: true });
    expect(r.destination).toMatchObject({ label: "Fixture stop C" });
    expect(r.journeys[0].fare).toMatchObject({ status: "complete", total: 10 });
    expect(r.dataSource).toBe("database");
    expect(r.notes.join(" ")).toMatch(/not shown/);
  });

  it("starts or ends at a landmark by walking to a nearby stop", async () => {
    const r = await runTripSearch(params({ from: "Fixture Hall" }), deps(base));
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.journeys[0].steps[0]).toMatchObject({ type: "walk", purpose: "access" });
  });

  it("starts from a map-selected coordinate", async () => {
    const r = await runTripSearch(params({ from: "@0.100000,0.101000" }), deps(base));
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.origin).toMatchObject({ source: "coordinates", fromVerifiedData: false });
  });

  it("passes the passenger category, filters, preference and transfer limit to the engine", async () => {
    const raw = network(
      [route("R1", ["A", "B"]), route("R2", ["B", "C"], { type: "multicab" })],
      [flatFare("R1", 5, { category: "student" }), flatFare("R2", 4, { category: "student" })],
    );
    const ok = await runTripSearch(params({ category: "student", maxTransfers: 1 }), deps(raw));
    expect(ok.status === "ok" && ok.journeys[0].fare).toMatchObject({ total: 9 });
    const none = await runTripSearch(params({ category: "student", maxTransfers: 0 }), deps(raw));
    expect(none).toMatchObject({ status: "no-journey", reason: "transfer-limit" });
    const filtered = await runTripSearch(params({ types: ["minibus"] }), deps(raw));
    expect(filtered.status).toBe("no-journey");
  });

  it("uses today's date in Manila to pick fares", async () => {
    const raw = network([route("R1", ["A", "B", "C"])], [flatFare("R1", 10, { effectiveFrom: "2026-06-02" })]);
    const r = await runTripSearch(params(), deps(raw)); // NOW is 2026-06-01 in Manila
    expect(r.status === "ok" && r.journeys[0].fare.status).toBe("incomplete");
  });
});

describe("failed database requests", () => {
  it("reports the failure and runs no search", async () => {
    const r = await runTripSearch(params(), { loadData: async () => ({ status: "error", message: "We couldn't load route data right now." }) });
    expect(r).toEqual({ status: "error", message: "We couldn't load route data right now." });
  });

  it("does not turn a failure into an empty or fake result", async () => {
    const r = await runTripSearch(params(), { loadData: async () => ({ status: "error", message: "down" }) });
    expect(r).not.toHaveProperty("journeys");
  });
});

describe("location problems", () => {
  it("asks which place when the name is ambiguous, for the right end", async () => {
    const raw = network([route("R1", ["A", "B"])]);
    const r = await runTripSearch(params({ to: "Fixture stop" }), deps(raw));
    expect(r.status).toBe("needs-choice");
    if (r.status === "needs-choice") {
      expect(r.end).toBe("destination");
      expect(r.candidates.length).toBeGreaterThan(1);
      expect(r.candidates[0].ref).toMatch(/^stop:/);
    }
  });

  it("reports an origin that cannot be found", async () => {
    const r = await runTripSearch(params({ from: "Nowhere Special" }), deps(base));
    expect(r).toMatchObject({ status: "location-problem", end: "origin", problem: "not-found" });
    expect(r.status === "location-problem" && r.message).toMatch(/couldn't find “Nowhere Special”/);
  });

  it("reports a destination outside the area", async () => {
    const r = await runTripSearch(params({ to: "14.6, 121.0" }), deps(base, { serviceArea: { south: 0, north: 1, west: 0, east: 1 } }));
    expect(r).toMatchObject({ status: "location-problem", end: "destination", problem: "outside-service-area" });
  });

  it("reports invalid coordinates", async () => {
    const r = await runTripSearch(params({ from: "95, 10" }), deps(base));
    expect(r).toMatchObject({ status: "location-problem", problem: "invalid" });
  });

  it("reports an unavailable geocoder without failing", async () => {
    const geocoder: Geocoder = { search: vi.fn(async () => { throw new GeocoderError("down"); }) };
    const r = await runTripSearch(params({ from: "Somewhere Else" }), deps(base, { geocoder }));
    expect(r).toMatchObject({ status: "location-problem", problem: "geocoder-unavailable" });
  });

  it("uses a geocoded place when it is the only match", async () => {
    const geocoder: Geocoder = { search: vi.fn(async () => [{ label: "Geocoded Place", position: { lat: 0.1, lng: 0.1007 } }]) };
    const r = await runTripSearch(params({ from: "Somewhere Else" }), deps(base, { geocoder }));
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.origin).toMatchObject({ source: "geocoder", fromVerifiedData: false, approximate: true });
  });
});

describe("no journey", () => {
  it("passes the engine's reason and message through with both resolved places", async () => {
    const raw = network([route("R1", ["A", "B"]), route("R2", ["D", "E"])]);
    const r = await runTripSearch(params({ to: "Fixture stop E" }), deps(raw));
    expect(r).toMatchObject({ status: "no-journey", reason: "no-route", origin: { label: "Fixture stop A" }, destination: { label: "Fixture stop E" } });
  });

  it("explains a missing nearby stop", async () => {
    const r = await runTripSearch(params({ from: "@0.150000,0.150000" }), deps(base));
    expect(r).toMatchObject({ status: "no-journey", reason: "no-boarding-stop-near-origin" });
    expect(r.status === "no-journey" && r.details.nearestStop).toBeDefined();
  });

  it("does not offer unverified routes", async () => {
    const r = await runTripSearch(params(), deps(network([route("R1", ["A", "B", "C"], { status: "unverified" })])));
    expect(r).toMatchObject({ status: "no-journey", reason: "only-unverified-routes" });
  });

  it("does not offer anything from an empty network", async () => {
    const r = await runTripSearch(params(), deps({ stops: GRID_STOPS, routes: [], fares: [] }));
    expect(r).toMatchObject({ status: "no-journey", reason: "no-usable-routes" });
  });

  it("returns a route with an explicitly unavailable fare when only the fare is missing", async () => {
    const r = await runTripSearch(params(), deps(network([route("R1", ["A", "B", "C"])])));
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.journeys[0].fare).toMatchObject({ status: "incomplete", missing: [{ reason: "no-fare-record" }] });
  });
});

describe("sample data", () => {
  const sampleRaw: RawNetwork = {
    stops: GRID_STOPS.map((x) => ({ ...x, status: "sample" as const })),
    routes: [route("R1", ["A", "B", "C"], { status: "sample" })],
    fares: [flatFare("R1", 1, { status: "sample" })],
  };

  it("is searched only when it is the data source, and every result is labelled", async () => {
    const r = await runTripSearch(params(), deps(sampleRaw, {}, "sample"));
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.dataSource).toBe("sample");
      expect(r.journeys[0].verification.dataStatus).toBe("sample");
    }
  });

  it("is never searched when the source is the database", async () => {
    const r = await runTripSearch(params(), deps(sampleRaw, {}, "database"));
    expect(r.status === "no-journey" || r.status === "location-problem").toBe(true);
  });
});
