import { describe, expect, it } from "vitest";
import { buildNetwork } from "@/lib/search/network";
import {
  DATE, at, atPoint, flatFare, journeys, network, pairFare, rides, route, run, stop, GRID_STOPS,
} from "@/lib/search/__fixtures__/fictional";

const noJourney = (o: ReturnType<typeof run>) => {
  if (o.status !== "no-journey") throw new Error("expected no journey");
  return o;
};

describe("direct trips", () => {
  const raw = network([route("R1", ["A", "B", "C", "D"])], [flatFare("R1", 12)]);

  it("finds a route that serves origin then destination in order", () => {
    const [j] = journeys(run(raw, "A", "C"));
    const [ride] = rides(j);
    expect(j.summary).toMatchObject({ transfers: 0, walkingMeters: 0, routeIds: ["R1"], stopsTravelled: 2 });
    expect(ride).toMatchObject({ routeId: "R1", board: { stopId: "A" }, alight: { stopId: "C" }, stopsTravelled: 2 });
    expect(ride.intermediateStops).toEqual(["Fixture stop B"]);
    expect(ride.instruction).toBe("Board Jeepney R1 (Fixture route R1) at Fixture stop A, toward Fixture stop D. Get off at Fixture stop C after 2 stops.");
  });

  it("does not add a walk when the origin and destination are the stops themselves", () => {
    const [j] = journeys(run(raw, "A", "C"));
    expect(j.steps.map((s) => s.type)).toEqual(["ride"]);
  });

  it("works for a middle section of a route", () => {
    expect(rides(journeys(run(raw, "B", "D"))[0])[0]).toMatchObject({ board: { stopId: "B" }, alight: { stopId: "D" } });
  });

  it("never claims travel times or real-time arrivals", () => {
    const outcome = run(raw, "A", "C");
    const [j] = journeys(outcome);
    expect(j.travelTime).toEqual({ available: false, reason: "no-timing-data" });
    expect(outcome.status === "ok" && outcome.notes.join(" ")).toMatch(/Travel times are not shown/);
  });

  it("is deterministic", () => {
    expect(run(raw, "A", "D")).toEqual(run(raw, "A", "D"));
  });
});

describe("direction and stop order", () => {
  it("uses the inbound direction's own stops for the reverse journey", () => {
    const raw = network([route("R1", ["A", "B", "C"], { inbound: ["C", "E", "A"] })]);
    const [j] = journeys(run(raw, "C", "A"));
    expect(rides(j)[0]).toMatchObject({ direction: "inbound", board: { stopId: "C" }, alight: { stopId: "A" }, stopsTravelled: 2 });
    expect(rides(j)[0].intermediateStops).toEqual(["Fixture stop E"]); // not B: the return trip is a different path
  });

  it("does not assume a one-way route can be ridden backwards", () => {
    const raw = network([route("R1", ["A", "B", "C", "D"])]);
    expect(noJourney(run(raw, "C", "B")).reason).toBe("no-route");
    // The last stop of a direction is not a place to board at all.
    expect(noJourney(run(raw, "D", "A")).reason).toBe("no-boarding-stop-near-origin");
  });

  it("rejects a journey whose destination comes before the origin on the route", () => {
    const raw = network([route("R1", ["A", "B", "C", "D"])]);
    expect(noJourney(run(raw, "C", "B")).reason).toBe("no-route");
    expect(journeys(run(raw, "B", "D"))).toHaveLength(1);
  });

  it("rejects a transfer onto a route that runs the wrong way", () => {
    const raw = network([route("R1", ["A", "B", "C"]), route("R2", ["F", "E", "C"])]); // R2 ends at C
    expect(noJourney(run(raw, "A", "E")).reason).toBe("no-route"); // E is reachable on R2 only by going the other way
  });

  it("keeps outbound and inbound as separate lines in the graph", () => {
    const net = buildNetwork(network([route("R1", ["A", "B", "C"], { inbound: ["C", "B", "A"] })]), {
      passengerCategory: "regular", date: DATE, acceptStatuses: ["verified"],
    });
    expect(net.lines.map((l) => l.id)).toEqual(["R1:outbound", "R1:inbound"]);
  });
});

describe("boarding and drop-off permissions", () => {
  it("will not board where boarding is not allowed", () => {
    const raw = network([route("R1", [{ id: "A", board: false }, "B", "C"])]);
    const o = noJourney(run(raw, "A", "C"));
    expect(o.reason).toBe("no-boarding-stop-near-origin");
    expect(o.details.nearestStop?.name).toBe("Fixture stop B");
  });

  it("can still pass through a stop where boarding is not allowed", () => {
    const raw = network([route("R1", ["A", { id: "B", board: false, alight: false }, "C"])]);
    expect(rides(journeys(run(raw, "A", "C"))[0])[0].intermediateStops).toEqual(["Fixture stop B"]);
  });

  it("will not get off where drop-off is not allowed", () => {
    const raw = network([route("R1", ["A", "B", { id: "C", alight: false }])]);
    expect(noJourney(run(raw, "A", "C")).reason).toBe("no-alighting-stop-near-destination");
  });

  it("walks from a nearby stop that does allow boarding", () => {
    const near = stop("A2", at(0, 0, 0, 2)); // about 290 m of estimated walking from A
    const raw = network([route("R1", [{ id: "A", board: false }, "A2", "C"])], [], { stops: [...GRID_STOPS, near] });
    const [j] = journeys(run(raw, "A", "C"));
    expect(j.steps[0]).toMatchObject({ type: "walk", purpose: "access", basis: "straight-line-estimate" });
    expect(j.summary.walkingMeters).toBeGreaterThan(200);
  });

  it("honours restrictions on transfers", () => {
    const raw = network([route("R1", ["A", "B", "C"]), route("R2", [{ id: "C", board: false }, "D", "E"])]);
    expect(noJourney(run(raw, "A", "E")).reason).toBe("no-route");
  });

  it("records the restrictions on graph edges", () => {
    const net = buildNetwork(network([route("R1", ["A", { id: "B", board: false }, { id: "C", alight: false }])]), {
      passengerCategory: "regular", date: DATE, acceptStatuses: ["verified"],
    });
    const [ab, bc] = net.edges;
    expect(ab).toMatchObject({ boardingStopId: "A", dropoffStopId: "B", fromSequence: 1, toSequence: 2, boardingAllowed: true, dropoffAllowed: true });
    expect(bc).toMatchObject({ boardingStopId: "B", dropoffStopId: "C", boardingAllowed: false, dropoffAllowed: false });
  });
});

describe("fares", () => {
  const base = [route("R1", ["A", "B", "C"])];

  it("uses a verified flat fare", () => {
    const [j] = journeys(run(network(base, [flatFare("R1", 12)]), "A", "C"));
    expect(j.fare).toEqual({ status: "complete", currency: "PHP", total: 12, breakdown: [{ routeId: "R1", routeName: "Fixture route R1", amount: 12 }] });
    expect(rides(j)[0].fare).toMatchObject({ status: "known", basis: "flat", amount: 12 });
  });

  it("prefers a stop-to-stop fare over the flat fare", () => {
    const fares = [flatFare("R1", 12), pairFare("R1", "A", "C", 9)];
    expect(journeys(run(network(base, fares), "A", "C"))[0].fare).toMatchObject({ total: 9 });
    expect(journeys(run(network(base, fares), "A", "B"))[0].fare).toMatchObject({ total: 12 });
  });

  it("does not price the reverse direction from a one-way stop-to-stop fare", () => {
    const raw = network([route("R1", ["A", "B", "C"], { inbound: ["C", "B", "A"] })], [pairFare("R1", "A", "C", 9)]);
    expect(journeys(run(raw, "A", "C"))[0].fare.status).toBe("complete");
    expect(journeys(run(raw, "C", "A"))[0].fare).toMatchObject({ status: "incomplete", missing: [{ reason: "no-fare-record" }] });
  });

  it("returns the journey with an explicitly unavailable fare, and no total, when there is no fare", () => {
    const [j] = journeys(run(network(base), "A", "C"));
    expect(j.fare).toEqual({ status: "incomplete", currency: "PHP", knownSubtotal: 0, missing: [{ routeId: "R1", routeName: "Fixture route R1", reason: "no-fare-record" }] });
    expect(j).not.toHaveProperty("fare.total");
    expect(rides(j)[0].fare).toEqual({ status: "unavailable", reason: "no-fare-record" });
    expect(j.notes.join(" ")).toMatch(/No fare is available for: Fixture route R1/);
    expect(j.verification.dataStatus).toBe("verified");
  });

  it("ignores unverified fares and says why", () => {
    const [j] = journeys(run(network(base, [flatFare("R1", 1, { status: "unverified" })]), "A", "C"));
    expect(rides(j)[0].fare).toEqual({ status: "unavailable", reason: "fare-not-verified" });
    expect(j.fare.status).toBe("incomplete");
  });

  it("ignores outdated fares", () => {
    const [j] = journeys(run(network(base, [flatFare("R1", 1, { status: "outdated" })]), "A", "C"));
    expect(rides(j)[0].fare).toMatchObject({ status: "unavailable", reason: "fare-not-verified" });
  });

  it("never substitutes the regular fare for another passenger category", () => {
    const raw = network(base, [flatFare("R1", 12)]);
    const [student] = journeys(run(raw, "A", "C", { category: "student" }));
    expect(rides(student)[0].fare).toEqual({ status: "unavailable", reason: "no-fare-for-category" });
    const withStudent = network(base, [flatFare("R1", 12), flatFare("R1", 9, { category: "student" })]);
    expect(journeys(run(withStudent, "A", "C", { category: "student" }))[0].fare).toMatchObject({ total: 9 });
    expect(journeys(run(withStudent, "A", "C", { category: "regular" }))[0].fare).toMatchObject({ total: 12 });
  });

  it("only uses a fare that is in force on the search date", () => {
    const fares = [
      flatFare("R1", 10, { effectiveFrom: "2026-01-01", effectiveUntil: "2026-05-31" }),
      flatFare("R1", 11, { effectiveFrom: "2026-06-01" }),
    ];
    expect(journeys(run(network(base, fares), "A", "C", { date: "2026-05-31" }))[0].fare).toMatchObject({ total: 10 });
    expect(journeys(run(network(base, fares), "A", "C", { date: "2026-06-01" }))[0].fare).toMatchObject({ total: 11 });
    expect(rides(journeys(run(network(base, fares), "A", "C", { date: "2025-12-31" }))[0])[0].fare.status).toBe("unavailable");
  });

  it("gives a total only when every segment has a known fare", () => {
    const routes = [route("R1", ["A", "B", "C"]), route("R2", ["C", "D", "E"])];
    const both = journeys(run(network(routes, [flatFare("R1", 8), flatFare("R2", 7.5)]), "A", "E"))[0];
    expect(both.fare).toMatchObject({ status: "complete", total: 15.5 });
    const one = journeys(run(network(routes, [flatFare("R1", 8)]), "A", "E"))[0];
    expect(one.fare).toMatchObject({ status: "incomplete", knownSubtotal: 8, missing: [{ routeId: "R2" }] });
    expect(one.fare).not.toHaveProperty("total");
  });

  it("adds fares exactly (no floating-point drift)", () => {
    const routes = [route("R1", ["A", "B"]), route("R2", ["B", "C"]), route("R3", ["C", "D"])];
    const fares = [flatFare("R1", 0.1), flatFare("R2", 0.2), flatFare("R3", 0.3)];
    expect(journeys(run(network(routes, fares), "A", "D", { maxTransfers: 2 }))[0].fare).toMatchObject({ total: 0.6 });
  });

  it("reports fare availability on graph edges", () => {
    const net = buildNetwork(
      network([route("R1", ["A", "B"]), route("R2", ["B", "C"]), route("R3", ["C", "D"])], [flatFare("R1", 1), pairFare("R2", "B", "C", 1)]),
      { passengerCategory: "regular", date: DATE, acceptStatuses: ["verified"] },
    );
    const by = Object.fromEntries(net.edges.map((e) => [e.routeId, e.fareAvailability]));
    expect(by).toEqual({ R1: "flat", R2: "by-stop-pair", R3: "none" });
  });
});

describe("transfers", () => {
  const routes = [route("R1", ["A", "B", "C"]), route("R2", ["C", "D", "E"])];
  const fares = [flatFare("R1", 8), flatFare("R2", 7)];

  it("transfers at a shared stop", () => {
    const [j] = journeys(run(network(routes, fares), "A", "E"));
    expect(j.summary).toMatchObject({ transfers: 1, routeIds: ["R1", "R2"], walkingMeters: 0 });
    expect(j.steps.map((s) => s.type)).toEqual(["ride", "walk", "ride"]);
    expect(j.steps[1]).toMatchObject({ type: "walk", purpose: "transfer", basis: "same-stop", meters: 0, instruction: "Transfer at Fixture stop C." });
    expect(j.fare).toMatchObject({ status: "complete", total: 15 });
  });

  it("transfers to a nearby stop when walking is short, and labels it an estimate", () => {
    const c2 = stop("C2", at(2, 0, 0, 1)); // about 111 m north: ~145 m estimated
    const raw = network([route("R1", ["A", "B", "C"]), route("R2", ["C2", "D", "E"])], fares, { stops: [...GRID_STOPS, c2] });
    const [j] = journeys(run(raw, "A", "E"));
    const walk = j.steps[1];
    expect(walk).toMatchObject({ type: "walk", purpose: "transfer", basis: "straight-line-estimate" });
    expect(walk.type === "walk" && walk.meters).toBeGreaterThan(100);
    expect(walk.type === "walk" && walk.meters).toBeLessThanOrEqual(200);
    expect(j.verification.walking).toBe("estimated");
    expect(j.notes.join(" ")).toMatch(/estimates/);
  });

  it("refuses a transfer between stops that are too far apart to walk", () => {
    const far = stop("C2", at(2, 0, 0, 4)); // about 445 m, over the 200 m limit
    const raw = network([route("R1", ["A", "B", "C"]), route("R2", ["C2", "D", "E"])], fares, { stops: [...GRID_STOPS, far] });
    expect(noJourney(run(raw, "A", "E")).reason).toBe("no-route");
    expect(journeys(run(raw, "A", "E", { maxTransferWalkMeters: 700 }))).toHaveLength(1); // configurable
  });

  it("uses a verified walking link instead of the straight-line estimate", () => {
    const far = stop("C2", at(2, 0, 0, 1));
    const raw = network([route("R1", ["A", "B", "C"]), route("R2", ["C2", "D", "E"])], fares, {
      stops: [...GRID_STOPS, far],
      transferLinks: [{ fromStopId: "C", toStopId: "C2", meters: 90, verified: true }],
    });
    const [j] = journeys(run(raw, "A", "E"));
    expect(j.steps[1]).toMatchObject({ basis: "verified-link", meters: 90 });
    expect(j.verification.walking).toBe("verified");
  });

  it("ignores walking links that are not verified", () => {
    const far = stop("C2", at(2, 0, 0, 4));
    const raw = network([route("R1", ["A", "B", "C"]), route("R2", ["C2", "D", "E"])], fares, {
      stops: [...GRID_STOPS, far],
      transferLinks: [{ fromStopId: "C", toStopId: "C2", meters: 50, verified: false }],
    });
    expect(noJourney(run(raw, "A", "E")).reason).toBe("no-route");
  });

  it("supports more than one transfer", () => {
    const chain = [route("R1", ["A", "B"]), route("R2", ["B", "C"]), route("R3", ["C", "D"])];
    const [j] = journeys(run(network(chain), "A", "D", { maxTransfers: 2 }));
    expect(j.summary).toMatchObject({ transfers: 2, routeIds: ["R1", "R2", "R3"] });
  });

  it("describes a transfer instruction for each change", () => {
    const chain = [route("R1", ["A", "B"]), route("R2", ["B", "C"])];
    const [j] = journeys(run(network(chain), "A", "C"));
    expect(j.steps.filter((s) => s.type === "walk")).toHaveLength(1);
    expect(rides(j).map((r) => r.instruction.split(" at ")[0])).toEqual(["Board Jeepney R1 (Fixture route R1)", "Board Jeepney R2 (Fixture route R2)"]);
  });
});

describe("maximum transfers", () => {
  const chain = [route("R1", ["A", "B"]), route("R2", ["B", "C"]), route("R3", ["C", "D"]), route("R4", ["D", "E"])];
  const raw = network(chain);

  it("stops at the configured limit and says how many transfers are needed", () => {
    const o = noJourney(run(raw, "A", "E", { maxTransfers: 1 }));
    expect(o.reason).toBe("transfer-limit");
    expect(o.details.transfersNeeded).toBe(3);
    expect(o.message).toMatch(/only with 3 transfers.*limit is 1/);
  });

  it("finds the journey once the limit allows it", () => {
    expect(journeys(run(raw, "A", "E", { maxTransfers: 3 }))[0].summary.transfers).toBe(3);
  });

  it("allows no transfers when the limit is zero", () => {
    expect(noJourney(run(raw, "A", "C", { maxTransfers: 0 })).reason).toBe("transfer-limit");
    expect(journeys(run(raw, "A", "B", { maxTransfers: 0 }))).toHaveLength(1);
  });

  it("caps an excessive limit instead of searching without bound", () => {
    const o = run(raw, "A", "E", { maxTransfers: 99 });
    expect(journeys(o)[0].summary.transfers).toBe(3);
  });

  it("reports no route when even the hard cap is not enough", () => {
    const long = Array.from({ length: 7 }, (_, i) => route(`L${i}`, [`S${i}`, `S${i + 1}`]));
    const stops = Array.from({ length: 8 }, (_, i) => stop(`S${i}`, at(i)));
    const o = noJourney(run(network(long, [], { stops }), "S0", "S7", { maxTransfers: 1 }));
    expect(o.reason).toBe("no-route");
  });
});

describe("cycles", () => {
  it("terminates on routes that form a loop and never reuses a route", () => {
    const loop = [route("R1", ["A", "B"]), route("R2", ["B", "C"]), route("R3", ["C", "A"])];
    const o = run(network(loop), "A", "C", { maxTransfers: 4, maxResults: 20 });
    const found = journeys(o);
    expect(found.length).toBeGreaterThan(0);
    for (const j of found) expect(new Set(j.summary.routeIds).size).toBe(j.summary.routeIds.length);
    expect(found[0].summary.routeIds).toEqual(["R1", "R2"]); // A to B to C; R3 goes C to A
  });

  it("does not return a journey that revisits a stop", () => {
    // R1 goes A..D; R2 comes back D..A..: riding R1 to D then R2 back to A then on would be a cycle.
    const raw = network([route("R1", ["A", "B", "C", "D"]), route("R2", ["D", "A", "E"])]);
    for (const j of journeys(run(raw, "A", "E", { maxTransfers: 4, maxResults: 20 }))) {
      const stops = rides(j).flatMap((r) => [r.board.stopId, r.alight.stopId]);
      const collapsed = stops.filter((s, i) => i === 0 || s !== stops[i - 1]);
      expect(new Set(collapsed).size).toBe(collapsed.length);
    }
  });

  it("returns no route (and does not hang) when the loop never reaches the destination", () => {
    const loop = [route("R1", ["A", "B"]), route("R2", ["B", "C"]), route("R3", ["C", "A"])];
    const o = noJourney(run(network(loop), "A", "F", { maxTransfers: 4 }));
    expect(["no-route", "no-alighting-stop-near-destination"]).toContain(o.reason);
  });
});

describe("duplicate routes", () => {
  it("folds routes that are identical in stops, permissions and fares into one result", () => {
    const raw = network([route("R1", ["A", "B", "C"]), route("R1b", ["A", "B", "C"])], [flatFare("R1", 10), flatFare("R1b", 10)]);
    const found = journeys(run(raw, "A", "C"));
    expect(found).toHaveLength(1);
    expect(rides(found[0])[0].routeId).toBe("R1");
    expect(rides(found[0])[0].alsoServedBy).toEqual([{ routeId: "R1b", routeCode: "R1b", routeName: "Fixture route R1b" }]);
  });

  it("keeps both when their fares differ, since the choice matters", () => {
    const raw = network([route("R1", ["A", "B", "C"]), route("R1b", ["A", "B", "C"])], [flatFare("R1", 10), flatFare("R1b", 12)]);
    expect(journeys(run(raw, "A", "C", { preference: "lowest-fare" })).map((j) => j.fare.status === "complete" && j.fare.total)).toEqual([10, 12]);
  });

  it("does not fold a multicab into a jeepney", () => {
    const raw = network([route("R1", ["A", "B"]), route("R1m", ["A", "B"], { type: "multicab" })]);
    expect(journeys(run(raw, "A", "B"))).toHaveLength(2);
  });

  it("does not list the same set of routes twice", () => {
    const raw = network([route("R1", ["A", "B", "C"], { inbound: ["C", "B", "A"] }), route("R2", ["C", "D", "E"])]);
    const ids = journeys(run(raw, "A", "E", { maxResults: 20 })).map((j) => j.summary.routeIds.join(">"));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("drops a transfer that is made redundant by a direct route", () => {
    const raw = network([route("R1", ["A", "B"]), route("R3", ["A", "B", "C", "D"])]);
    const o = run(raw, "A", "D", { maxResults: 20 });
    const found = journeys(o);
    expect(found.map((j) => j.summary.routeIds)).toEqual([["R3"]]);
  });
});

describe("failure states", () => {
  const raw = network([route("R1", ["A", "B", "C"])]);

  it("reports when nothing connects the places", () => {
    const o = noJourney(run(network([route("R1", ["A", "B"]), route("R2", ["D", "E"])]), "A", "E"));
    expect(o.reason).toBe("no-route");
  });

  it("reports no boarding stop near the origin, with the nearest one", () => {
    const o = noJourney(run(raw, atPoint(at(5, 5)), "C"));
    expect(o.reason).toBe("no-boarding-stop-near-origin");
    expect(o.details.nearestStop).toMatchObject({ name: "Fixture stop B" }); // C is the end of the line: no boarding
    expect(o.message).toMatch(/within about 500 m/);
  });

  it("reports no stop near the destination", () => {
    expect(noJourney(run(raw, "A", atPoint(at(5, 5)))).reason).toBe("no-alighting-stop-near-destination");
  });

  it("makes the walking threshold configurable", () => {
    const origin = atPoint(at(0, 0, 0, 6)); // about 670 m north of A, over the default 500 m
    expect(noJourney(run(raw, origin, "C")).reason).toBe("no-boarding-stop-near-origin");
    expect(journeys(run(raw, origin, "C", { maxAccessWalkMeters: 1200 }))[0].steps[0]).toMatchObject({ type: "walk", purpose: "access" });
  });

  it("walks to a nearby stop but never claims a road exists between them", () => {
    const [j] = journeys(run(raw, atPoint(at(0, 0, 0, 2), "Fixture origin"), atPoint(at(2, 0, 0, 2), "Fixture destination")));
    expect(j.steps.map((s) => s.type)).toEqual(["walk", "ride", "walk"]);
    expect(j.steps[0]).toMatchObject({ basis: "straight-line-estimate" });
    expect(j.verification.walking).toBe("estimated");
    expect(j.notes.join(" ")).toMatch(/walking path itself is not verified/);
  });

  it("does not offer unverified routes", () => {
    const o = noJourney(run(network([route("R1", ["A", "B"], { status: "unverified" })]), "A", "B"));
    expect(o.reason).toBe("only-unverified-routes");
  });

  it("does not offer outdated routes, and uses the verified ones only", () => {
    const raw2 = network([route("R1", ["A", "B"], { status: "outdated" }), route("R2", ["A", "B"])]);
    expect(journeys(run(raw2, "A", "B")).map((j) => j.summary.routeIds[0])).toEqual(["R2"]);
  });

  it("does not offer sample data in production mode", () => {
    expect(noJourney(run(network([route("R1", ["A", "B"], { status: "sample" })]), "A", "B")).reason).toBe("only-unverified-routes");
  });

  it("offers sample data only when explicitly allowed, and labels it", () => {
    const raw2 = network([route("R1", ["A", "B"], { status: "sample" })], [flatFare("R1", 1, { status: "sample" })]);
    const [j] = journeys(run(raw2, "A", "B", { acceptStatuses: ["verified", "sample"] }));
    expect(j.verification.dataStatus).toBe("sample");
    expect(j.notes.join(" ")).toMatch(/Sample data/);
  });

  it("reports no usable routes when there are none at all", () => {
    expect(noJourney(run(network([]), "A", "B")).reason).toBe("no-usable-routes");
  });

  it("reports when the transport filter leaves nothing", () => {
    const o = noJourney(run(raw, "A", "C", { transportTypes: ["multicab"] }));
    expect(o.reason).toBe("no-routes-for-filters");
    expect(journeys(run(raw, "A", "C", { transportTypes: ["jeepney"] }))).toHaveLength(1);
  });

  it("applies the transport filter to every leg", () => {
    const mixed = network([route("R1", ["A", "B", "C"]), route("R2", ["C", "D"], { type: "multicab" })]);
    expect(noJourney(run(mixed, "A", "D", { transportTypes: ["jeepney"] })).reason).toMatch(/no-route|no-alighting/);
    expect(journeys(run(mixed, "A", "D", { transportTypes: ["jeepney", "multicab"] }))).toHaveLength(1);
  });

  it("treats the same place as no trip", () => {
    expect(noJourney(run(raw, "A", "A")).reason).toBe("origin-equals-destination");
    expect(noJourney(run(raw, atPoint(at(0)), atPoint(at(0, 0, 0, 0)))).reason).toBe("origin-equals-destination");
  });
});

describe("data integrity", () => {
  const opts = { passengerCategory: "regular" as const, date: DATE, acceptStatuses: ["verified"] as const };

  it("leaves out a direction that includes an unverified stop", () => {
    const stops = GRID_STOPS.map((s) => (s.id === "B" ? { ...s, status: "unverified" as const } : s));
    const net = buildNetwork(network([route("R1", ["A", "B", "C"])], [], { stops }), opts);
    expect(net.lines).toHaveLength(0);
    expect(net.diagnostics.excludedLines).toEqual([{ lineId: "R1:outbound", reason: "unusable-stop" }]);
  });

  it("leaves out a direction whose stop positions have a gap", () => {
    const r = route("R1", ["A", "B", "C"]);
    r.directions[0].stops[2].order = 4;
    expect(buildNetwork(network([r]), opts).diagnostics.excludedLines).toEqual([{ lineId: "R1:outbound", reason: "sequence-gap" }]);
  });

  it("leaves out a direction with an unknown stop or fewer than two stops", () => {
    expect(buildNetwork(network([route("R1", ["A", "ZZ"])]), opts).diagnostics.excludedLines[0].reason).toBe("unknown-stop");
    expect(buildNetwork(network([route("R2", ["A"])]), opts).diagnostics.excludedLines[0].reason).toBe("too-short");
  });

  it("treats a stop at 0,0 as unusable", () => {
    const stops = [...GRID_STOPS.filter((s) => s.id !== "B"), stop("B", { lat: 0, lng: 0 })];
    expect(buildNetwork(network([route("R1", ["A", "B"])], [], { stops }), opts).lines).toHaveLength(0);
  });

  it("builds one node per usable stop and one edge per consecutive pair", () => {
    const net = buildNetwork(network([route("R1", ["A", "B", "C"], { inbound: ["C", "A"] })]), opts);
    expect([...net.nodes.keys()].sort()).toEqual(["A", "B", "C"]);
    expect(net.edges.map((e) => `${e.lineId}:${e.boardingStopId}>${e.dropoffStopId}`)).toEqual([
      "R1:outbound:A>B", "R1:outbound:B>C", "R1:inbound:C>A",
    ]);
    expect(net.edges[0]).toMatchObject({ routeId: "R1", transportType: "jeepney", verification: "verified" });
  });

  it("does not search a route that is verified only on paper (unverified status)", () => {
    expect(buildNetwork(network([route("R1", ["A", "B"], { status: "unverified" })]), opts).diagnostics.excludedUnverifiedRoutes).toBe(1);
  });
});

describe("ranking", () => {
  // Direct R1 is dear; R2 + R3 via C is cheaper but needs a transfer.
  const raw = network(
    [route("R1", ["A", "B", "C", "D", "E"]), route("R2", ["A", "C"]), route("R3", ["C", "E"])],
    [flatFare("R1", 30), flatFare("R2", 5), flatFare("R3", 5)],
  );

  it("fewest transfers puts the direct route first", () => {
    const found = journeys(run(raw, "A", "E", { preference: "fewest-transfers", maxResults: 10 }));
    expect(found[0].summary.routeIds).toEqual(["R1"]);
  });

  it("lowest fare puts the cheaper, transferring journey first", () => {
    const found = journeys(run(raw, "A", "E", { preference: "lowest-fare", maxResults: 10 }));
    expect(found[0].summary.routeIds).toEqual(["R2", "R3"]);
    expect(found[0].fare).toMatchObject({ total: 10 });
    expect(found[1].fare).toMatchObject({ total: 30 });
  });

  it("returns several candidates when several exist", () => {
    expect(journeys(run(raw, "A", "E", { maxResults: 10 })).length).toBe(2);
  });

  it("limits the number of results", () => {
    expect(journeys(run(raw, "A", "E", { maxResults: 1 }))).toHaveLength(1);
  });

  it("ranks a journey with an unknown fare after one with a known fare when comparing fares", () => {
    const r = network([route("R1", ["A", "B", "C"]), route("R2", ["A", "B", "C"], { type: "multicab" })], [flatFare("R2", 50)]);
    const found = journeys(run(r, "A", "C", { preference: "lowest-fare" }));
    expect(found.map((j) => j.summary.routeIds[0])).toEqual(["R2", "R1"]);
    expect(found[1].fare.status).toBe("incomplete");
  });

  it("shortest walking picks the journey that needs the least walking", () => {
    const near = stop("A2", at(0, 0, 0, 3));
    const raw2 = network([route("R1", ["A2", "C"]), route("R2", ["A", "B", "C"])], [], { stops: [...GRID_STOPS, near] });
    const origin = atPoint(at(0, 0, 0, 3), "Fixture origin"); // right at A2, ~330 m from A
    expect(journeys(run(raw2, origin, "C", { preference: "shortest-walking" }))[0].summary.routeIds).toEqual(["R1"]);
  });

  it("breaks ties deterministically", () => {
    const r = network([route("RB", ["A", "B"]), route("RA", ["A", "B"], { type: "multicab" })]);
    expect(journeys(run(r, "A", "B")).map((j) => j.summary.routeIds[0])).toEqual(["RA", "RB"]);
  });
});

describe("map geometry per segment", () => {
  const line = [at(0), at(1), at(2), at(3)];

  it("returns the part of the recorded line between boarding and alighting", () => {
    const raw = network([route("R1", ["A", "B", "C", "D"], { geometry: [line] })]);
    const [ride] = rides(journeys(run(raw, "B", "D"))[0]);
    expect(ride.geometry).toEqual({ status: "ok", lines: [[at(1), at(2), at(3)]] });
  });

  it("does not draw a line when none is recorded", () => {
    const [ride] = rides(journeys(run(network([route("R1", ["A", "B", "C"])]), "A", "C"))[0]);
    expect(ride.geometry).toEqual({ status: "unavailable", reason: "not-recorded" });
  });

  it("does not draw a line that does not pass near the stops", () => {
    const elsewhere = [at(0, 5), at(3, 5)];
    const [ride] = rides(journeys(run(network([route("R1", ["A", "B", "C"], { geometry: [elsewhere] })]), "A", "C"))[0]);
    expect(ride.geometry).toEqual({ status: "unavailable", reason: "stops-not-on-geometry" });
  });

  it("does not draw a line that runs the other way", () => {
    const backwards = [at(3), at(2), at(1), at(0)];
    const [ride] = rides(journeys(run(network([route("R1", ["A", "B", "C"], { geometry: [backwards] })]), "A", "C"))[0]);
    expect(ride.geometry).toEqual({ status: "unavailable", reason: "order-mismatch" });
  });

  it("uses the inbound direction's own geometry", () => {
    const out = [at(0), at(2)];
    const back = [at(2), at(1, 1), at(0)];
    const raw = network([route("R1", ["A", "C"], { geometry: [out], inbound: ["C", "A"], inboundGeometry: [back] })]);
    const [ride] = rides(journeys(run(raw, "C", "A"))[0]);
    expect(ride.geometry).toEqual({ status: "ok", lines: [[at(2), at(1, 1), at(0)]] });
  });

  it("keeps each piece of a multi-part line separate and leaves the gap empty", () => {
    const parts = [[at(0), at(1)], [at(2), at(3)]];
    const [ride] = rides(journeys(run(network([route("R1", ["A", "B", "C", "D"], { geometry: parts })]), "A", "D"))[0]);
    expect(ride.geometry).toEqual({ status: "ok", lines: [[at(0), at(1)], [at(2), at(3)]] });
  });

  it("summarises how much of the journey can be drawn", () => {
    const raw = network([route("R1", ["A", "B"], { geometry: [[at(0), at(1)]] }), route("R2", ["B", "C"])]);
    const [j] = journeys(run(raw, "A", "C"));
    expect(j.verification.geometry).toBe("partial");
    expect(j.notes.join(" ")).toMatch(/map line is not available/);
  });
});

describe("verification details in results", () => {
  it("reports the oldest verification used and warns when it is stale", () => {
    const raw = network([route("R1", ["A", "B"], { lastVerifiedAt: "2025-01-01T00:00:00Z" }), route("R2", ["B", "C"], { lastVerifiedAt: "2026-05-01T00:00:00Z" })]);
    const [j] = journeys(run(raw, "A", "C"));
    expect(j.verification.oldestVerifiedAt).toBe("2025-01-01T00:00:00Z");
    expect(j.notes.join(" ")).toMatch(/more than 180 days old/);
  });

  it("gives every journey a stable id", () => {
    const raw = network([route("R1", ["A", "B", "C"])]);
    expect(journeys(run(raw, "A", "C"))[0].id).toBe("R1:outbound@A>C");
  });
});
