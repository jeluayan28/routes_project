import type { DirectionKind, FareCategory } from "@/lib/validation/route";
import type { Coordinate, VehicleType, VerificationStatus } from "@/lib/validation/transport";

/**
 * Types for the route-search engine. The engine is pure: it takes a plain
 * `RawNetwork` (loaded from the database elsewhere) and returns journeys. It never
 * performs I/O and never invents data.
 */

// ---------------------------------------------------------------------------
// Input data
// ---------------------------------------------------------------------------

export type RawStop = {
  id: string;
  name: string;
  position: Coordinate;
  status: VerificationStatus;
};

export type RawRouteStop = {
  stopId: string;
  /** 1-based position in the direction. Must be contiguous (1..n). */
  order: number;
  /** Already resolved: the route's override if any, else the stop's own setting. */
  canBoard: boolean;
  canAlight: boolean;
};

export type RawDirection = {
  kind: DirectionKind;
  stops: RawRouteStop[];
  /** Recorded geometry only. Empty means none is recorded. */
  geometry: Coordinate[][];
};

export type RawRoute = {
  id: string;
  code: string;
  name: string;
  transportType: VehicleType;
  status: VerificationStatus;
  lastVerifiedAt: string | null;
  directions: RawDirection[];
};

export type RawFare = {
  routeId: string;
  /** Both null for a flat fare on the whole route. */
  fromStopId: string | null;
  toStopId: string | null;
  category: FareCategory;
  /** Pesos. */
  amount: number;
  effectiveFrom: string;
  effectiveUntil: string | null;
  status: VerificationStatus;
};

/** An administrator-verified walkable connection between two stops (optional). */
export type RawTransferLink = {
  fromStopId: string;
  toStopId: string;
  meters: number;
  verified: boolean;
};

export type RawNetwork = {
  stops: RawStop[];
  routes: RawRoute[];
  fares: RawFare[];
  transferLinks?: RawTransferLink[];
};

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type Preference = "lowest-fare" | "fewest-transfers" | "shortest-walking";
export const PREFERENCES: readonly Preference[] = ["lowest-fare", "fewest-transfers", "shortest-walking"];

/** Data states the engine will use. Production uses only "verified". */
export type AcceptedStatus = Extract<VerificationStatus, "verified" | "sample">;

export type SearchOptions = {
  passengerCategory: FareCategory;
  /** Calendar date (YYYY-MM-DD, Asia/Manila) used to pick the applicable fare. */
  date: string;
  /** Empty or undefined means every transport type. */
  transportTypes?: readonly VehicleType[];
  preference: Preference;
  maxTransfers: number;
  /** Longest walk from the origin to the first stop and from the last stop to the destination. */
  maxAccessWalkMeters: number;
  /** Longest walk between two different stops when transferring. */
  maxTransferWalkMeters: number;
  /** Walking distance = straight-line distance times this (roads are not straight). */
  walkCircuity: number;
  maxCandidateStops: number;
  maxResults: number;
  acceptStatuses: readonly AcceptedStatus[];
  /** Safety valve on route combinations examined. */
  maxPatterns: number;
};

export const HARD_MAX_TRANSFERS = 4;

export const DEFAULT_SEARCH_OPTIONS: Omit<SearchOptions, "date"> = {
  passengerCategory: "regular",
  preference: "fewest-transfers",
  maxTransfers: 2,
  maxAccessWalkMeters: 500,
  maxTransferWalkMeters: 200,
  walkCircuity: 1.3,
  maxCandidateStops: 8,
  maxResults: 5,
  acceptStatuses: ["verified"],
  maxPatterns: 5000,
};

// ---------------------------------------------------------------------------
// Built network
// ---------------------------------------------------------------------------

export type FareAvailability = "flat" | "by-stop-pair" | "none";

/** Directed connection between two consecutive stops of one route direction. */
export type GraphEdge = {
  routeId: string;
  lineId: string;
  transportType: VehicleType;
  direction: DirectionKind;
  boardingStopId: string;
  dropoffStopId: string;
  /** Positions (1-based) of the two stops in the direction. */
  fromSequence: number;
  toSequence: number;
  boardingAllowed: boolean;
  dropoffAllowed: boolean;
  fareAvailability: FareAvailability;
  verification: VerificationStatus;
};

export type GraphNode = {
  stopId: string;
  name: string;
  position: Coordinate;
  outgoing: GraphEdge[];
  incoming: GraphEdge[];
};

/** One route direction as an ordered chain of graph nodes. */
export type Line = {
  id: string;
  routeId: string;
  code: string;
  name: string;
  transportType: VehicleType;
  direction: DirectionKind;
  verification: VerificationStatus;
  lastVerifiedAt: string | null;
  stopIds: string[];
  canBoard: boolean[];
  canAlight: boolean[];
  geometry: Coordinate[][];
  /** Name of the last stop: "toward X". */
  towardName: string;
  /** Other lines that are identical (same type and stop sequence); folded into this one. */
  equivalentLineIds: string[];
  equivalentRoutes: { routeId: string; code: string; name: string }[];
};

export type BuildDiagnostics = {
  /** Routes left out because they are not in an accepted status. */
  excludedUnverifiedRoutes: number;
  /** Route directions left out for data problems (reason per line). */
  excludedLines: { lineId: string; reason: "unknown-stop" | "unusable-stop" | "sequence-gap" | "too-short" }[];
  excludedByTransportFilter: number;
  duplicateLinesFolded: number;
  unusableStops: number;
};

export type TransitNetwork = {
  nodes: Map<string, GraphNode>;
  edges: GraphEdge[];
  lines: Line[];
  diagnostics: BuildDiagnostics;
  transferLinks: Map<string, { meters: number; verified: boolean }>;
};

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export type StopRef = { stopId: string; name: string; position: Coordinate };

export type LegFare =
  | {
      status: "known";
      amount: number;
      category: FareCategory;
      basis: "stop-to-stop" | "flat";
      dataStatus: AcceptedStatus;
      effectiveFrom: string;
    }
  | { status: "unavailable"; reason: "no-fare-record" | "no-fare-for-category" | "fare-not-verified" };

export type WalkBasis = "same-stop" | "verified-link" | "straight-line-estimate";

export type WalkStep = {
  type: "walk";
  purpose: "access" | "transfer" | "egress";
  from: { label: string; position: Coordinate; stopId?: string };
  to: { label: string; position: Coordinate; stopId?: string };
  /** Estimated walking distance in metres (0 for a same-stop transfer). */
  meters: number;
  basis: WalkBasis;
  instruction: string;
};

export type RideGeometry =
  | { status: "ok"; lines: Coordinate[][] }
  | { status: "unavailable"; reason: "not-recorded" | "stops-not-on-geometry" | "order-mismatch" };

export type RideStep = {
  type: "ride";
  routeId: string;
  routeCode: string;
  routeName: string;
  transportType: VehicleType;
  direction: DirectionKind;
  towardName: string;
  board: StopRef;
  alight: StopRef;
  /** Stops travelled, not counting the boarding stop. */
  stopsTravelled: number;
  intermediateStops: string[];
  fare: LegFare;
  geometry: RideGeometry;
  /** Routes that are identical to this one and were folded into it. */
  alsoServedBy: { routeId: string; routeCode: string; routeName: string }[];
  instruction: string;
};

export type JourneyStep = WalkStep | RideStep;

export type FareSummary =
  | { status: "complete"; total: number; currency: "PHP"; breakdown: { routeId: string; routeName: string; amount: number }[] }
  | {
      status: "incomplete";
      /** Sum of the segments whose fare is known. Not a total. */
      knownSubtotal: number;
      currency: "PHP";
      missing: { routeId: string; routeName: string; reason: Extract<LegFare, { status: "unavailable" }>["reason"] }[];
    };

export type Journey = {
  /** Stable for the same boarding/alighting stops on the same routes. */
  id: string;
  steps: JourneyStep[];
  summary: {
    transfers: number;
    walkingMeters: number;
    stopsTravelled: number;
    routeIds: string[];
  };
  fare: FareSummary;
  verification: {
    /** "verified" only if every route, stop and fare used is verified. */
    dataStatus: "verified" | "sample";
    /** Walking distances are straight-line estimates unless a verified link says otherwise. */
    walking: "estimated" | "verified" | "none";
    geometry: "complete" | "partial" | "none";
    oldestVerifiedAt: string | null;
  };
  /** Travel time is deliberately not estimated: there is no timing data. */
  travelTime: { available: false; reason: "no-timing-data" };
  notes: string[];
};

export type NoJourneyReason =
  | "no-usable-routes"
  | "only-unverified-routes"
  | "no-routes-for-filters"
  | "no-boarding-stop-near-origin"
  | "no-alighting-stop-near-destination"
  | "origin-equals-destination"
  | "transfer-limit"
  | "no-route";

export type NoJourney = {
  status: "no-journey";
  reason: NoJourneyReason;
  message: string;
  details: {
    nearestStop?: { name: string; meters: number };
    /** When reason is "transfer-limit": the fewest transfers that would work. */
    transfersNeeded?: number;
  };
};

export type SearchOutcome =
  | {
      status: "ok";
      journeys: Journey[];
      notes: string[];
      /** Identical routes folded into one, results dropped as redundant, etc. */
      diagnostics: { patternsEvaluated: number; truncated: boolean; redundantDropped: number };
    }
  | NoJourney;

export type SearchPoint = {
  label: string;
  position: Coordinate;
  /** Set when the point is itself a known stop. */
  stopId?: string;
};
