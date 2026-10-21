import { todayInManila } from "@/lib/dates";
import type { DataResult, DataSource } from "@/lib/data/routes";
import { searchJourneys } from "@/lib/search/engine";
import type { Geocoder } from "@/lib/search/geocoder";
import type { SearchData } from "@/lib/search/load";
import { resolveLocation, type LocationCandidate, type Resolution, type ResolvedLocation, type ServiceArea } from "@/lib/search/locations";
import { buildNetwork } from "@/lib/search/network";
import type { TripParams } from "@/lib/search/params";
import type { Journey, NoJourneyReason, SearchOptions } from "@/lib/search/types";

export type LocationProblem = "not-found" | "invalid" | "outside-service-area" | "geocoder-unavailable";

type End = "origin" | "destination";

/** What the search page shows. Every failure the engine can hit has its own state. */
export type TripSearchResponse =
  | {
      status: "ok";
      origin: ResolvedLocation;
      destination: ResolvedLocation;
      journeys: Journey[];
      notes: string[];
      dataSource: DataSource;
    }
  | {
      status: "no-journey";
      origin: ResolvedLocation;
      destination: ResolvedLocation;
      reason: NoJourneyReason;
      message: string;
      details: { nearestStop?: { name: string; meters: number }; transfersNeeded?: number };
      dataSource: DataSource;
    }
  | { status: "needs-choice"; end: End; typed: string; candidates: LocationCandidate[] }
  | { status: "location-problem"; end: End; typed: string; problem: LocationProblem; message: string }
  | { status: "error"; message: string };

export type ServiceDeps = {
  loadData: () => Promise<DataResult<SearchData>>;
  geocoder?: Geocoder | null;
  /** Area places must fall in. Defaults to the Butuan sanity box; null turns the check off. */
  serviceArea?: ServiceArea | null;
  /** Overrides for the engine (distances, result count, …). */
  options?: Partial<SearchOptions>;
  now?: Date;
};

const PROBLEM_MESSAGE: Record<LocationProblem, (end: End, typed: string) => string> = {
  "not-found": (end, typed) =>
    `We couldn't find “${typed}”. Try the name of a stop or landmark, or pick the ${end === "origin" ? "starting point" : "destination"} on the map.`,
  invalid: (_end, typed) => `“${typed}” isn't a usable place.`,
  "outside-service-area": (end) =>
    `The ${end === "origin" ? "starting point" : "destination"} is outside the area this guide covers.`,
  "geocoder-unavailable": (end) =>
    `Place search is unavailable right now, so we couldn't look that ${end === "origin" ? "starting point" : "destination"} up. Try the name of a known stop or landmark.`,
};

function problemOf(res: Exclude<Resolution, { status: "resolved" | "ambiguous" }>, end: End, typed: string): TripSearchResponse {
  const problem: LocationProblem = res.status;
  const message = res.status === "invalid" ? res.message : PROBLEM_MESSAGE[problem](end, typed);
  return { status: "location-problem", end, typed, problem, message };
}

/**
 * Runs one trip search end to end: load approved data, resolve both places,
 * build the network, search. Dependencies are injected so every failure path is
 * testable without a database.
 */
export async function runTripSearch(params: TripParams, deps: ServiceDeps): Promise<TripSearchResponse> {
  const data = await deps.loadData();
  if (data.status === "error") return { status: "error", message: data.message };

  const { network, stops, landmarks } = data.data;
  const acceptStatuses = data.source === "sample" ? (["verified", "sample"] as const) : (["verified"] as const);
  const ctx = { stops, landmarks, geocoder: deps.geocoder ?? null, acceptStatuses, serviceArea: deps.serviceArea };

  const [from, to] = await Promise.all([resolveLocation(params.from, ctx), resolveLocation(params.to, ctx)]);
  for (const [end, typed, res] of [["origin", params.from, from], ["destination", params.to, to]] as const) {
    if (res.status === "ambiguous") return { status: "needs-choice", end, typed, candidates: res.candidates };
    if (res.status !== "resolved") return problemOf(res, end, typed);
  }
  const origin = (from as Extract<Resolution, { status: "resolved" }>).location;
  const destination = (to as Extract<Resolution, { status: "resolved" }>).location;

  const options = {
    passengerCategory: params.category,
    date: todayInManila(deps.now),
    transportTypes: params.types,
    preference: params.preference,
    maxTransfers: params.maxTransfers,
    acceptStatuses,
    ...deps.options,
  };
  const built = buildNetwork(network, options);
  const outcome = searchJourneys(built, origin, destination, options);

  if (outcome.status === "no-journey") {
    return { status: "no-journey", origin, destination, reason: outcome.reason, message: outcome.message, details: outcome.details, dataSource: data.source };
  }
  return { status: "ok", origin, destination, journeys: outcome.journeys, notes: outcome.notes, dataSource: data.source };
}
