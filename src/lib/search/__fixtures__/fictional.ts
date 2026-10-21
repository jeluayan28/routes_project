import { buildNetwork } from "@/lib/search/network";
import { searchJourneys } from "@/lib/search/engine";
import type {
  RawFare,
  RawNetwork,
  RawRoute,
  RawStop,
  SearchOptions,
  SearchOutcome,
  SearchPoint,
} from "@/lib/search/types";
import type { FareCategory } from "@/lib/validation/route";
import type { Coordinate, VehicleType, VerificationStatus } from "@/lib/validation/transport";

/**
 * TEST FIXTURES ONLY. Nothing here is a real Butuan route, stop or fare.
 *
 * Stops sit on an abstract grid near 0.1°, 0.1° (open sea). One grid step is
 * 0.01° of longitude or latitude, about 1.1 km, so grid stops are never within
 * walking range of each other unless a test deliberately offsets them.
 */

export const DATE = "2026-06-01";

/** Grid position. `dx`/`dy` add a small offset in 0.001° steps (about 111 m). */
export const at = (x: number, y = 0, dx = 0, dy = 0): Coordinate => ({
  lat: 0.1 + y * 0.01 + dy * 0.001,
  lng: 0.1 + x * 0.01 + dx * 0.001,
});

export const stop = (id: string, position: Coordinate, status: VerificationStatus = "verified"): RawStop => ({
  id,
  name: `Fixture stop ${id}`,
  position,
  status,
});

/** Stops along the x axis: A=0, B=1, C=2, D=3, E=4, F=5. */
export const GRID_STOPS: RawStop[] = ["A", "B", "C", "D", "E", "F"].map((id, x) => stop(id, at(x)));

type StopSpec = string | { id: string; board?: boolean; alight?: boolean };

export function route(
  id: string,
  outbound: StopSpec[],
  opts: {
    inbound?: StopSpec[];
    type?: VehicleType;
    status?: VerificationStatus;
    geometry?: Coordinate[][];
    inboundGeometry?: Coordinate[][];
    lastVerifiedAt?: string | null;
  } = {},
): RawRoute {
  const dir = (specs: StopSpec[], kind: "outbound" | "inbound", geometry: Coordinate[][]) => ({
    kind,
    geometry,
    stops: specs.map((s, i) => {
      const o = typeof s === "string" ? { id: s } : s;
      return { stopId: o.id, order: i + 1, canBoard: o.board ?? true, canAlight: o.alight ?? true };
    }),
  });
  return {
    id,
    code: id,
    name: `Fixture route ${id}`,
    transportType: opts.type ?? "jeepney",
    status: opts.status ?? "verified",
    lastVerifiedAt: opts.lastVerifiedAt === undefined ? "2026-05-01T00:00:00Z" : opts.lastVerifiedAt,
    directions: [
      dir(outbound, "outbound", opts.geometry ?? []),
      ...(opts.inbound ? [dir(opts.inbound, "inbound", opts.inboundGeometry ?? [])] : []),
    ],
  };
}

export const flatFare = (
  routeId: string,
  amount: number,
  over: Partial<RawFare> = {},
): RawFare => ({
  routeId, fromStopId: null, toStopId: null, category: "regular", amount,
  effectiveFrom: "2026-01-01", effectiveUntil: null, status: "verified", ...over,
});

export const pairFare = (routeId: string, from: string, to: string, amount: number, over: Partial<RawFare> = {}): RawFare =>
  flatFare(routeId, amount, { fromStopId: from, toStopId: to, ...over });

export const network = (routes: RawRoute[], fares: RawFare[] = [], extra: Partial<RawNetwork> = {}): RawNetwork => ({
  stops: GRID_STOPS,
  routes,
  fares,
  ...extra,
});

/** A search point that is exactly a stop of the grid. */
export const atStop = (raw: RawNetwork, id: string): SearchPoint => {
  const s = raw.stops.find((x) => x.id === id)!;
  return { label: s.name, position: s.position, stopId: s.id };
};

/** A plain coordinate (not a known stop). */
export const atPoint = (position: Coordinate, label = "Fixture point"): SearchPoint => ({ label, position });

export type RunOptions = Partial<SearchOptions> & { category?: FareCategory };

/** Build the network and search it, the way the service does. */
export function run(raw: RawNetwork, from: SearchPoint | string, to: SearchPoint | string, opts: RunOptions = {}): SearchOutcome {
  const { category, ...rest } = opts;
  const options = { date: DATE, ...rest, ...(category ? { passengerCategory: category } : {}) };
  const built = buildNetwork(raw, {
    passengerCategory: options.passengerCategory ?? "regular",
    date: options.date,
    acceptStatuses: options.acceptStatuses ?? ["verified"],
    transportTypes: options.transportTypes,
  });
  return searchJourneys(built, typeof from === "string" ? atStop(raw, from) : from, typeof to === "string" ? atStop(raw, to) : to, options);
}

export function journeys(outcome: SearchOutcome) {
  if (outcome.status !== "ok") throw new Error(`expected journeys, got ${outcome.reason}`);
  return outcome.journeys;
}

export function rides(journey: ReturnType<typeof journeys>[number]) {
  return journey.steps.flatMap((s) => (s.type === "ride" ? [s] : []));
}
