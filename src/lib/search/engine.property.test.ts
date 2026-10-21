import { describe, expect, it } from "vitest";
import { distanceMeters } from "@/lib/routes/geometry";
import { buildNetwork } from "@/lib/search/network";
import { searchJourneys } from "@/lib/search/engine";
import { DATE, at, flatFare, pairFare, route, stop } from "@/lib/search/__fixtures__/fictional";
import type { RawFare, RawNetwork, RawRoute, RawStop, RideStep, SearchOptions } from "@/lib/search/types";

/**
 * Randomised checks on invented networks (see __fixtures__/fictional.ts). A fixed
 * seed makes every run identical, so a failure can be reproduced.
 */

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const OPTS: Pick<SearchOptions, "maxTransferWalkMeters" | "maxAccessWalkMeters" | "walkCircuity"> = {
  maxTransferWalkMeters: 200,
  maxAccessWalkMeters: 500,
  walkCircuity: 1.3,
};

function randomNetwork(seed: number): RawNetwork {
  const r = rng(seed);
  const stops: RawStop[] = [];
  const ids = ["S0", "S1", "S2", "S3", "S4", "S5", "S6", "S7"];
  ids.forEach((id, i) => {
    // Some stops sit close to an earlier one (walkable transfers); the rest are on a coarse grid.
    const close = i >= 4 && r() < 0.5;
    const base = close ? stops[i - 4].position : at(Math.floor(r() * 4), Math.floor(r() * 3));
    stops.push(stop(id, close ? { lat: base.lat + 0.0007, lng: base.lng } : base));
  });

  const routes: RawRoute[] = [];
  const fares: RawFare[] = [];
  const routeCount = 3 + Math.floor(r() * 4);
  for (let k = 0; k < routeCount; k++) {
    const pool = [...ids];
    const length = 2 + Math.floor(r() * 4);
    const chosen: string[] = [];
    while (chosen.length < length && pool.length) chosen.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
    const specs = chosen.map((id) => ({ id, board: r() > 0.15, alight: r() > 0.15 }));
    routes.push(route(`R${k}`, specs, { type: r() < 0.3 ? "multicab" : "jeepney", status: r() < 0.1 ? "unverified" : "verified" }));
    if (r() < 0.6) fares.push(flatFare(`R${k}`, 5 + Math.floor(r() * 20)));
    if (r() < 0.3 && chosen.length >= 2) fares.push(pairFare(`R${k}`, chosen[0], chosen[chosen.length - 1], 3 + Math.floor(r() * 5)));
    if (r() < 0.1) fares.push(flatFare(`R${k}`, 99, { status: "unverified" }));
  }
  return { stops, routes, fares };
}

const posOf = (raw: RawNetwork, id: string) => raw.stops.find((s) => s.id === id)!.position;
const rideOf = (j: { steps: unknown[] }) => j.steps.filter((s): s is RideStep => (s as { type: string }).type === "ride");

function search(raw: RawNetwork, from: string, to: string, extra: Partial<SearchOptions> = {}) {
  const options = { date: DATE, ...extra };
  const built = buildNetwork(raw, { passengerCategory: "regular", date: DATE, acceptStatuses: ["verified"], transportTypes: options.transportTypes });
  const point = (id: string) => ({ label: id, position: posOf(raw, id), stopId: id });
  return searchJourneys(built, point(from), point(to), options);
}

/** Every journey must satisfy the rules, whatever the network. */
function assertSound(raw: RawNetwork, from: string, to: string, maxTransfers: number, transportTypes?: SearchOptions["transportTypes"]) {
  const out = search(raw, from, to, { maxTransfers, maxResults: 50, transportTypes });
  if (out.status !== "ok") return 0;
  for (const j of out.journeys) {
    const rides = rideOf(j);
    expect(rides.length - 1).toBeLessThanOrEqual(maxTransfers);
    expect(j.summary.transfers).toBe(rides.length - 1);
    expect(new Set(rides.map((x) => x.routeId)).size).toBe(rides.length); // no route twice

    let total = 0;
    let missing = 0;
    const visited: string[] = [];
    rides.forEach((ride, t) => {
      const route = raw.routes.find((r) => r.id === ride.routeId)!;
      expect(route.status).toBe("verified");
      if (transportTypes?.length) expect(transportTypes).toContain(route.transportType);

      const dir = route.directions.find((d) => d.kind === ride.direction)!;
      const order = (id: string) => dir.stops.find((s) => s.stopId === id)!;
      expect(order(ride.board.stopId).order).toBeLessThan(order(ride.alight.stopId).order); // right order and direction
      expect(order(ride.board.stopId).canBoard).toBe(true);
      expect(order(ride.alight.stopId).canAlight).toBe(true);
      expect(ride.stopsTravelled).toBe(order(ride.alight.stopId).order - order(ride.board.stopId).order);

      if (t > 0) {
        const prev = rides[t - 1].alight;
        const meters = ride.board.stopId === prev.stopId ? 0 : distanceMeters(prev.position, ride.board.position) * OPTS.walkCircuity;
        expect(meters).toBeLessThanOrEqual(OPTS.maxTransferWalkMeters + 1); // feasible walk
      }
      if (ride.board.stopId !== rides[t - 1]?.alight.stopId) visited.push(ride.board.stopId);
      visited.push(ride.alight.stopId);

      if (ride.fare.status === "known") total += Math.round(ride.fare.amount * 100);
      else missing++;
    });
    expect(new Set(visited).size).toBe(visited.length); // no stop visited twice

    if (missing === 0) expect(j.fare).toMatchObject({ status: "complete", total: total / 100 });
    else expect(j.fare).toMatchObject({ status: "incomplete", knownSubtotal: total / 100 });
    expect(j.fare.status === "complete").toBe(missing === 0);
  }
  return out.journeys.length;
}

/** Brute force for up to one transfer, written independently of the engine. */
function bruteForceMinTransfers(raw: RawNetwork, from: string, to: string, transportTypes?: SearchOptions["transportTypes"]): number | null {
  type Leg = { routeId: string; board: string; alight: string; boardOrder: number; alightOrder: number };
  const legs: Leg[] = [];
  for (const route of raw.routes) {
    if (route.status !== "verified") continue;
    if (transportTypes?.length && !transportTypes.includes(route.transportType)) continue;
    for (const d of route.directions) {
      for (const a of d.stops) for (const b of d.stops) {
        if (a.order < b.order && a.canBoard && b.canAlight && a.stopId !== b.stopId) {
          legs.push({ routeId: route.id, board: a.stopId, alight: b.stopId, boardOrder: a.order, alightOrder: b.order });
        }
      }
    }
  }
  // The route must not be reused, and a stop is visited once. A leg-level stop-order check is enough for one transfer.
  const walkOk = (x: string, y: string) => x === y || distanceMeters(posOf(raw, x), posOf(raw, y)) * OPTS.walkCircuity <= OPTS.maxTransferWalkMeters;
  if (legs.some((l) => l.board === from && l.alight === to)) return 0;
  for (const a of legs.filter((l) => l.board === from)) {
    for (const b of legs) {
      if (b.routeId === a.routeId || b.alight !== to) continue;
      if (!walkOk(a.alight, b.board)) continue;
      const visited = [a.board, a.alight, ...(b.board === a.alight ? [] : [b.board]), b.alight];
      if (new Set(visited).size === visited.length) return 1;
    }
  }
  return null;
}

describe("randomised invariants (invented networks)", () => {
  it("every journey obeys direction, order, permissions, transfer walking, fares and uniqueness", () => {
    let journeysChecked = 0;
    for (let seed = 1; seed <= 150; seed++) {
      const raw = randomNetwork(seed);
      const r = rng(seed * 7919);
      const ids = raw.stops.map((s) => s.id);
      const from = ids[Math.floor(r() * ids.length)];
      let to = ids[Math.floor(r() * ids.length)];
      if (to === from) to = ids[(ids.indexOf(from) + 1) % ids.length];
      for (const maxTransfers of [0, 1, 2, 3]) journeysChecked += assertSound(raw, from, to, maxTransfers);
    }
    expect(journeysChecked).toBeGreaterThan(100); // the test is actually exercising journeys
  });

  it("respects the transport filter in every leg", () => {
    for (let seed = 200; seed < 260; seed++) {
      const raw = randomNetwork(seed);
      assertSound(raw, "S0", "S1", 2, ["jeepney"]);
      assertSound(raw, "S2", "S3", 2, ["multicab"]);
    }
  });

  it("finds a journey within one transfer exactly when brute force says there is one", () => {
    let found = 0;
    let none = 0;
    for (let seed = 300; seed < 500; seed++) {
      const raw = randomNetwork(seed);
      for (const [from, to] of [["S0", "S1"], ["S2", "S5"], ["S3", "S7"]] as const) {
        const expected = bruteForceMinTransfers(raw, from, to);
        // Candidate stops near the origin could add legs the brute force (which starts at the stop itself) lacks,
        // so compare only when no other stop is within walking range of either end.
        const crowded = [from, to].some((id) => raw.stops.some((s) => s.id !== id && distanceMeters(posOf(raw, id), s.position) * OPTS.walkCircuity <= OPTS.maxAccessWalkMeters));
        if (crowded) continue;
        const out = search(raw, from, to, { maxTransfers: 1, maxResults: 50 });
        const engine = out.status === "ok" ? Math.min(...out.journeys.map((j) => j.summary.transfers)) : null;
        expect({ seed, from, to, engine }).toEqual({ seed, from, to, engine: expected });
        if (expected === null) none++;
        else found++;
      }
    }
    expect(found).toBeGreaterThan(10);
    expect(none).toBeGreaterThan(10);
  });

  it("is deterministic and never mutates its input", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const raw = randomNetwork(seed);
      const snapshot = JSON.stringify(raw);
      const a = search(raw, "S0", "S3", { maxTransfers: 2 });
      const b = search(raw, "S0", "S3", { maxTransfers: 2 });
      expect(a).toEqual(b);
      expect(JSON.stringify(raw)).toBe(snapshot);
    }
  });
});
