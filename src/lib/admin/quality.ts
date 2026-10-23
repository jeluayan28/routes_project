import { isInsideServiceArea } from "@/lib/constants";
import { isStale } from "@/lib/admin/dashboard";

type Verification = "unverified" | "verified" | "outdated";

export type QualityInput = {
  now: Date;
  /** YYYY-MM-DD in Asia/Manila. */
  today: string;
  routes: { id: string; name: string; code: string | null; status: "draft" | "active" | "inactive"; verification_status: Verification; last_verified_at: string | null; is_sample: boolean }[];
  routeStops: { route_id: string; direction: "outbound" | "inbound"; stop_order: number }[];
  shapes: { route_id: string; direction: "outbound" | "inbound"; verification_status: Verification }[];
  fares: { route_id: string; effective_from: string; effective_until: string | null; verification_status: Verification; verified_at: string | null }[];
  stops: { id: string; name: string; latitude: number; longitude: number; verification_status: Verification; last_verified_at: string | null; is_sample: boolean }[];
};

export const ROUTE_FLAGS = ["no-verified-geometry", "missing-stop-sequence", "no-fares", "fares-expired", "stale-verification", "stale-fares"] as const;
export const STOP_FLAGS = ["unverified-coordinates", "stale-verification"] as const;
export type RouteFlag = (typeof ROUTE_FLAGS)[number];
export type StopFlag = (typeof STOP_FLAGS)[number];

export const FLAG_LABEL: Record<RouteFlag | StopFlag, string> = {
  "no-verified-geometry": "No verified route geometry",
  "missing-stop-sequence": "Missing or broken stop sequence",
  "no-fares": "No fare rules",
  "fares-expired": "Fare rules expired or not started",
  "stale-verification": "Verification is out of date",
  "stale-fares": "A fare's verification is out of date",
  "unverified-coordinates": "Coordinates not verified",
};

export type QualityReport = {
  routes: { id: string; name: string; code: string | null; status: string; flags: RouteFlag[] }[];
  stops: { id: string; name: string; flags: StopFlag[]; detail: string | null }[];
  /** How many records carry each flag. */
  counts: Record<RouteFlag | StopFlag, number>;
};

/** A direction's positions must be exactly 1..n with no gaps or repeats. */
const contiguous = (orders: number[]) => {
  const sorted = [...orders].sort((a, b) => a - b);
  return sorted.every((o, i) => o === i + 1);
};

/**
 * Where the data is not good enough to rely on, from the records alone:
 *
 *  - geometry:   a direction with stops has no verified recorded line.
 *  - sequence:   no outbound stops (at least two are needed), or a direction whose
 *                positions have a gap or a repeat.
 *  - fares:      none recorded, or none in force today (all ended or not yet started).
 *  - stale:      verified longer ago than the configured threshold, or marked outdated.
 *  - stops:      coordinates not verified, a placeholder (0, 0), or outside Butuan.
 *
 * Sample records are never flagged: they are not real data and never public.
 */
export function computeQuality(input: QualityInput): QualityReport {
  const { now, today } = input;
  const routes: QualityReport["routes"] = [];

  for (const r of input.routes) {
    if (r.is_sample) continue;
    const flags: RouteFlag[] = [];
    const stops = input.routeStops.filter((s) => s.route_id === r.id);
    const shapes = input.shapes.filter((s) => s.route_id === r.id);

    const directionsWithStops = (["outbound", "inbound"] as const).filter((d) => stops.some((s) => s.direction === d));
    const outbound = stops.filter((s) => s.direction === "outbound");
    if (outbound.length < 2 || directionsWithStops.some((d) => !contiguous(stops.filter((s) => s.direction === d).map((s) => s.stop_order)))) {
      flags.push("missing-stop-sequence");
    }
    if (directionsWithStops.length === 0 || directionsWithStops.some((d) => !shapes.some((s) => s.direction === d && s.verification_status === "verified"))) {
      flags.push("no-verified-geometry");
    }

    const fares = input.fares.filter((f) => f.route_id === r.id);
    if (fares.length === 0) flags.push("no-fares");
    else if (!fares.some((f) => f.effective_from <= today && (f.effective_until === null || f.effective_until >= today))) flags.push("fares-expired");
    if (fares.some((f) => f.verification_status === "outdated" || (f.verification_status === "verified" && isStale(f.verified_at, now)))) flags.push("stale-fares");

    if (r.verification_status === "outdated" || (r.verification_status === "verified" && isStale(r.last_verified_at, now))) flags.push("stale-verification");

    if (flags.length > 0) routes.push({ id: r.id, name: r.name, code: r.code, status: r.status, flags });
  }

  const stops: QualityReport["stops"] = [];
  for (const s of input.stops) {
    if (s.is_sample) continue;
    const flags: StopFlag[] = [];
    let detail: string | null = null;
    if (!Number.isFinite(s.latitude) || !Number.isFinite(s.longitude)) detail = "Invalid coordinates";
    else if (s.latitude === 0 && s.longitude === 0) detail = "Placeholder coordinates (0, 0)";
    else if (!isInsideServiceArea({ lat: s.latitude, lng: s.longitude })) detail = "Outside Butuan City";
    if (s.verification_status !== "verified" || detail) flags.push("unverified-coordinates");
    if (s.verification_status === "outdated" || (s.verification_status === "verified" && isStale(s.last_verified_at, now))) flags.push("stale-verification");
    if (flags.length > 0) stops.push({ id: s.id, name: s.name, flags, detail });
  }

  const counts = Object.fromEntries([...ROUTE_FLAGS, ...STOP_FLAGS].map((f) => [f, 0])) as QualityReport["counts"];
  for (const r of routes) for (const f of r.flags) counts[f]++;
  for (const s of stops) for (const f of s.flags) counts[f]++;
  // "stale-verification" is shared by routes and stops, so the total above counts both.
  return { routes, stops, counts };
}
