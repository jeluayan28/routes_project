import { BUTUAN_SERVICE_AREA } from "@/lib/constants";
import { distanceMeters } from "@/lib/routes/geometry";
import type { Geocoder } from "@/lib/search/geocoder";
import type { AcceptedStatus, SearchPoint } from "@/lib/search/types";
import type { Coordinate, VerificationStatus } from "@/lib/validation/transport";

export type KnownStop = { id: string; name: string; position: Coordinate; status: VerificationStatus };
export type KnownLandmark = { id: string; name: string; category: string; position: Coordinate; status: VerificationStatus };

export type LocationSource = "stop" | "landmark" | "geocoder" | "coordinates";

export type LocationCandidate = {
  /** Round-trips through the URL: `stop:<id>`, `landmark:<id>` or `@lat,lng`. */
  ref: string;
  source: Exclude<LocationSource, "coordinates">;
  label: string;
  detail?: string;
  position: Coordinate;
};

export type ResolvedLocation = SearchPoint & {
  source: LocationSource;
  /** The location came from verified data (a stop or landmark), not a guess or the user's own click. */
  fromVerifiedData: boolean;
  /** True when a partial name matched a single place; shown so the user can check it. */
  approximate: boolean;
};

export type Resolution =
  | { status: "resolved"; location: ResolvedLocation }
  | { status: "ambiguous"; candidates: LocationCandidate[] }
  | { status: "not-found" }
  | { status: "invalid"; message: string }
  | { status: "outside-service-area"; position: Coordinate }
  | { status: "geocoder-unavailable" };

export type ServiceArea = { south: number; north: number; west: number; east: number };

export type ResolveContext = {
  stops: readonly KnownStop[];
  landmarks: readonly KnownLandmark[];
  geocoder?: Geocoder | null;
  /** null disables the check. */
  serviceArea?: ServiceArea | null;
  acceptStatuses?: readonly AcceptedStatus[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COORDINATES = /^@?\s*(-?\d{1,3}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;
const MAX_CANDIDATES = 6;
/** A stop and a landmark this close with the same name are one place. */
const SAME_PLACE_METERS = 100;

/** Lower-case, accent-free, punctuation-free, single-spaced. */
export const normalizeName = (s: string) =>
  s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();

export const coordinateRef = (c: Coordinate) => `@${c.lat.toFixed(6)},${c.lng.toFixed(6)}`;

const inside = (c: Coordinate, area: ServiceArea) => c.lat >= area.south && c.lat <= area.north && c.lng >= area.west && c.lng <= area.east;

/**
 * Turns what a person typed (or a link carried) into a point:
 *
 *  - `stop:<uuid>` / `landmark:<uuid>`: that verified record;
 *  - `@lat,lng` or `lat, lng`: a coordinate chosen on a map or typed;
 *  - otherwise a name, matched against verified stops and landmarks first
 *    (exact, then partial), and only if nothing matches, the geocoder.
 *
 * Several equally good matches are returned as `ambiguous` for the user to pick:
 * nothing is chosen silently. Unverified stops are never matched by name.
 */
export async function resolveLocation(input: string, ctx: ResolveContext): Promise<Resolution> {
  const text = input.trim();
  if (text === "") return { status: "invalid", message: "Enter a place." };
  if (text.length > 120) return { status: "invalid", message: "That place is too long." };

  const area = ctx.serviceArea === undefined ? BUTUAN_SERVICE_AREA : ctx.serviceArea;
  const accept = ctx.acceptStatuses ?? ["verified"];
  const okStatus = (s: string) => (accept as readonly string[]).includes(s);
  const stops = ctx.stops.filter((s) => okStatus(s.status));
  const landmarks = ctx.landmarks.filter((l) => okStatus(l.status));

  const known = /^(stop|landmark):(.+)$/i.exec(text);
  if (known) {
    const id = known[2].trim();
    if (!UUID.test(id)) return { status: "invalid", message: "That place link is not valid." };
    if (known[1].toLowerCase() === "stop") {
      const s = stops.find((x) => x.id.toLowerCase() === id.toLowerCase());
      return s ? { status: "resolved", location: stopLocation(s, false) } : { status: "not-found" };
    }
    const l = landmarks.find((x) => x.id.toLowerCase() === id.toLowerCase());
    return l ? { status: "resolved", location: landmarkLocation(l, false) } : { status: "not-found" };
  }

  const coords = COORDINATES.exec(text);
  if (coords) {
    const position = { lat: Number(coords[1]), lng: Number(coords[2]) };
    if (Math.abs(position.lat) > 90 || Math.abs(position.lng) > 180) {
      return { status: "invalid", message: "Those coordinates are outside the valid range (latitude -90 to 90, longitude -180 to 180)." };
    }
    if (position.lat === 0 && position.lng === 0) return { status: "invalid", message: "0, 0 is not a real location." };
    if (area && !inside(position, area)) return { status: "outside-service-area", position };
    return {
      status: "resolved",
      location: { label: `Selected point (${position.lat.toFixed(5)}, ${position.lng.toFixed(5)})`, position, source: "coordinates", fromVerifiedData: false, approximate: false },
    };
  }

  const query = normalizeName(text);
  if (query === "") return { status: "invalid", message: "Enter a place name or coordinates." };
  const tokens = query.split(" ");

  type Entry = { candidate: LocationCandidate; name: string; rank: number; stop?: KnownStop; landmark?: KnownLandmark };
  const entries: Entry[] = [
    ...stops.map((s): Entry => ({ candidate: { ref: `stop:${s.id}`, source: "stop", label: s.name, detail: "Stop", position: s.position }, name: normalizeName(s.name), rank: 0, stop: s })),
    ...landmarks.map((l): Entry => ({ candidate: { ref: `landmark:${l.id}`, source: "landmark", label: l.name, detail: l.category, position: l.position }, name: normalizeName(l.name), rank: 1, landmark: l })),
  ];

  const collapse = (list: Entry[]) => {
    // A stop and a landmark of the same name in the same spot are one place: keep the stop.
    const kept: Entry[] = [];
    for (const e of list.sort((a, b) => a.rank - b.rank || a.candidate.label.localeCompare(b.candidate.label))) {
      const twin = kept.find((k) => k.name === e.name && distanceMeters(k.candidate.position, e.candidate.position) <= SAME_PLACE_METERS);
      if (!twin) kept.push(e);
    }
    return kept;
  };

  const choose = (list: Entry[], approximate: boolean): Resolution | null => {
    const kept = collapse(list);
    if (kept.length === 0) return null;
    if (kept.length === 1) {
      const e = kept[0];
      return { status: "resolved", location: e.stop ? stopLocation(e.stop, approximate) : landmarkLocation(e.landmark!, approximate) };
    }
    return { status: "ambiguous", candidates: kept.slice(0, MAX_CANDIDATES).map((e) => e.candidate) };
  };

  const exact = choose(entries.filter((e) => e.name === query), false);
  if (exact) return exact;
  // Every typed word must start a word of the name ("plaza" finds "Town Plaza").
  const partial = choose(
    entries.filter((e) => {
      const words = e.name.split(" ");
      return tokens.every((t) => words.some((w) => w.startsWith(t)));
    }),
    true,
  );
  if (partial) return partial;

  if (!ctx.geocoder) return { status: "not-found" };
  try {
    const hits = (await ctx.geocoder.search(text)).filter(
      (h) => Number.isFinite(h.position.lat) && Number.isFinite(h.position.lng) && (!area || inside(h.position, area)),
    );
    if (hits.length === 0) return { status: "not-found" };
    if (hits.length === 1) {
      const h = hits[0];
      return { status: "resolved", location: { label: h.label, position: h.position, source: "geocoder", fromVerifiedData: false, approximate: true } };
    }
    return {
      status: "ambiguous",
      candidates: hits.slice(0, MAX_CANDIDATES).map((h) => ({ ref: coordinateRef(h.position), source: "geocoder" as const, label: h.label, detail: "Place search result", position: h.position })),
    };
  } catch {
    // The geocoder is optional and best-effort: report it, never crash the search.
    return { status: "geocoder-unavailable" };
  }
}

const stopLocation = (s: KnownStop, approximate: boolean): ResolvedLocation => ({
  label: s.name, position: s.position, stopId: s.id, source: "stop", fromVerifiedData: true, approximate,
});

const landmarkLocation = (l: KnownLandmark, approximate: boolean): ResolvedLocation => ({
  label: l.name, position: l.position, source: "landmark", fromVerifiedData: true, approximate,
});
