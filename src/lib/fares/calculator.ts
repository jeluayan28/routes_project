import { fromCentavos, pesosToCentavos, toCentavos } from "@/lib/fares/money";
import { collides, inForce, isIsoDate, ruleProblem } from "@/lib/fares/rules";
import type {
  FareAvailability,
  FareOptions,
  FareRule,
  FareSegment,
  FareSummary,
  FareUnavailableReason,
  LegFare,
  TripFare,
  TripFareSegment,
  UsableStatus,
} from "@/lib/fares/types";

const DEFAULT_ACCEPT: readonly UsableStatus[] = ["verified"];

/** Higher is more trustworthy. Used only so a draft never competes with a verified rule. */
const TRUST: Record<string, number> = { verified: 2, sample: 1, unverified: 0 };

const isUsable = (status: string, accept: readonly UsableStatus[]): status is UsableStatus => (accept as readonly string[]).includes(status);

/** Dates are only compared for rules whose dates parse; a malformed rule cannot be proven out of force. */
const maybeInForce = (rule: FareRule, date: string) =>
  !(isIsoDate(rule.effectiveFrom) && (rule.effectiveUntil === null || isIsoDate(rule.effectiveUntil))) || inForce(rule, date);

const unavailable = (reason: FareUnavailableReason): LegFare => ({ status: "unavailable", reason });

/**
 * The fare for one ridden segment: one route, from a boarding stop to a drop-off
 * stop, for one passenger category on one date.
 *
 *  - Only rules in an accepted status (default: verified) and in force on the
 *    date are used. A rule that is not is only ever reported as the reason.
 *  - A rule for the exact boarding and drop-off stops wins over a flat route fare.
 *    If a rule for the exact stops exists but is unusable, the flat fare is NOT
 *    used in its place: the segment is unavailable.
 *  - Direction matters: A to B does not price B to A.
 *  - The category is never substituted: no student rule means no student fare.
 *  - Malformed rules are rejected. Overlapping rules with different prices are
 *    rejected as conflicting; identical duplicates collapse to one.
 *  - There is no default fare. Without a usable rule the segment is unavailable.
 */
export function calculateSegmentFare(
  rules: readonly FareRule[],
  segment: Pick<FareSegment, "routeId" | "boardingStopId" | "dropoffStopId">,
  opts: FareOptions,
): LegFare {
  const accept = opts.acceptStatuses ?? DEFAULT_ACCEPT;
  const { boardingStopId: from, dropoffStopId: to } = segment;
  if (!from || !to || from === to) return unavailable("invalid-segment");

  const routeRules = rules.filter((r) => r.routeId === segment.routeId);
  const isPair = (r: FareRule) => r.fromStopId === from && r.toStopId === to;
  const isFlat = (r: FareRule) => r.fromStopId === null && r.toStopId === null;

  // Narrow step by step so the reason names the first requirement that failed.
  const relevant = routeRules.filter((r) => isPair(r) || isFlat(r));
  if (relevant.length === 0) return unavailable("no-fare-record");
  const current = relevant.filter((r) => maybeInForce(r, opts.date));
  if (current.length === 0) return unavailable("fare-not-in-force");
  const trusted = current.filter((r) => isUsable(r.status, accept));
  if (trusted.length === 0) return unavailable("fare-not-verified");
  const candidates = trusted.filter((r) => r.category === opts.category);
  if (candidates.length === 0) return unavailable("no-fare-for-category");

  const pair = candidates.filter(isPair);
  const tier = pair.length > 0 ? pair : candidates;

  const wellFormed = tier.filter((r) => ruleProblem(r) === null);
  if (wellFormed.length === 0) return unavailable("invalid-fare-record");

  // A more trusted rule overrides a draft; among equals, disagreement is a conflict.
  const best = Math.max(...wellFormed.map((r) => TRUST[r.status] ?? 0));
  const peers = wellFormed.filter((r) => (TRUST[r.status] ?? 0) === best);
  const disagree = peers.some((a, i) => peers.some((b, j) => i < j && collides(a, b) && pesosToCentavos(a.amount) !== pesosToCentavos(b.amount)));
  if (disagree) return unavailable("conflicting-fare-rules");

  // Identical duplicates: pick deterministically so the same data always gives the same answer.
  const chosen = [...peers].sort((a, b) => (a.id ?? "").localeCompare(b.id ?? "") || a.effectiveFrom.localeCompare(b.effectiveFrom))[0];
  return {
    status: "known",
    amount: fromCentavos(pesosToCentavos(chosen.amount)!),
    category: chosen.category,
    basis: chosen.fromStopId === null ? "flat" : "stop-to-stop",
    dataStatus: chosen.status as UsableStatus,
    effectiveFrom: chosen.effectiveFrom,
    effectiveUntil: chosen.effectiveUntil,
    ruleId: chosen.id ?? null,
    source: chosen.source?.trim() || null,
    verifiedAt: chosen.verifiedAt ?? null,
  };
}

/** Sum of the known segment fares, in centavos. */
const knownCentavos = (legs: readonly { fare: LegFare }[]) => legs.reduce((sum, l) => sum + (l.fare.status === "known" ? toCentavos(l.fare.amount) : 0), 0);

/** A total only when every ridden segment has a known fare; otherwise the missing ones are listed. */
export function summarizeLegFares(legs: readonly { routeId: string; routeName: string; fare: LegFare }[]): FareSummary {
  const missing = legs.flatMap((l) => (l.fare.status === "unavailable" ? [{ routeId: l.routeId, routeName: l.routeName, reason: l.fare.reason }] : []));
  const centavos = knownCentavos(legs);
  if (missing.length === 0) {
    return {
      status: "complete",
      currency: "PHP",
      total: fromCentavos(centavos),
      breakdown: legs.map((l) => ({ routeId: l.routeId, routeName: l.routeName, amount: l.fare.status === "known" ? l.fare.amount : 0 })),
    };
  }
  return { status: "incomplete", currency: "PHP", knownSubtotal: fromCentavos(centavos), missing };
}

/**
 * Builds the trip-level result from per-segment fares. Each segment is priced
 * separately; the total exists only if every segment is known. "verified" means
 * every segment's fare is verified; any other fully known mix is "unverified".
 */
export function assembleTripFare(segments: readonly TripFareSegment[], meta: Pick<FareOptions, "category">): TripFare {
  const missing = segments.flatMap((s, i) => (s.fare.status === "unavailable" ? [i] : []));
  const known = segments.flatMap((s) => (s.fare.status === "known" ? [s.fare] : []));
  const complete = segments.length > 0 && missing.length === 0;
  const stamps = known.map((f) => f.verifiedAt);
  const allStamped = known.length > 0 && stamps.every((s): s is string => s !== null);
  const centavos = knownCentavos(segments);

  return {
    currency: "PHP",
    category: meta.category,
    verification: !complete ? "unavailable" : known.every((f) => f.dataStatus === "verified") ? "verified" : "unverified",
    sample: known.some((f) => f.dataStatus === "sample"),
    total: complete ? fromCentavos(centavos) : null,
    knownSubtotal: fromCentavos(centavos),
    segments: [...segments],
    missing,
    verifiedAt: allStamped ? (stamps as string[]).reduce((a, b) => (a < b ? a : b)) : null,
    sources: [...new Set(known.flatMap((f) => (f.source ? [f.source] : [])))],
  };
}

/** A set of fare rules indexed by route, for pricing many segments. */
export type FareBook = {
  segment(segment: Pick<FareSegment, "routeId" | "boardingStopId" | "dropoffStopId">): LegFare;
  trip(segments: readonly FareSegment[]): TripFare;
  /** Whether the route has any usable fare for this category and date. */
  availability(routeId: string): FareAvailability;
  /** Identical for routes whose applicable fares are identical. */
  fingerprint(routeId: string): string;
};

export function createFareBook(rules: readonly FareRule[], opts: FareOptions): FareBook {
  const accept = opts.acceptStatuses ?? DEFAULT_ACCEPT;
  const byRoute = new Map<string, FareRule[]>();
  for (const r of rules) {
    const list = byRoute.get(r.routeId);
    if (list) list.push(r);
    else byRoute.set(r.routeId, [r]);
  }
  const cache = new Map<string, LegFare>();

  const usable = (routeId: string) =>
    (byRoute.get(routeId) ?? []).filter(
      (r) => r.category === opts.category && maybeInForce(r, opts.date) && isUsable(r.status, accept) && ruleProblem(r) === null,
    );

  const segment: FareBook["segment"] = (s) => {
    const key = `${s.routeId}|${s.boardingStopId}|${s.dropoffStopId}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const result = calculateSegmentFare(byRoute.get(s.routeId) ?? [], s, opts);
    cache.set(key, result);
    return result;
  };

  return {
    segment,
    trip: (segments) => assembleTripFare(segments.map((s) => ({ ...s, fare: segment(s) })), opts),
    availability(routeId) {
      const list = usable(routeId);
      if (list.some((r) => r.fromStopId === null)) return "flat";
      return list.length > 0 ? "by-stop-pair" : "none";
    },
    fingerprint: (routeId) =>
      usable(routeId)
        .map((r) => `${r.fromStopId ?? "*"}>${r.toStopId ?? "*"}=${pesosToCentavos(r.amount)}@${r.effectiveFrom}`)
        .sort()
        .join(";"),
  };
}

/**
 * The fare for riding one route from a boarding stop to a drop-off stop, for a
 * passenger category on a date.
 */
export function calculateFare(
  rules: readonly FareRule[],
  ride: { routeId: string; boardingStopId: string; dropoffStopId: string; routeName?: string },
  opts: FareOptions,
): TripFare {
  return createFareBook(rules, opts).trip([ride]);
}

/** A journey with transfers: each segment is priced on its own, and summed only if all are known. */
export function calculateTripFare(rules: readonly FareRule[], segments: readonly FareSegment[], opts: FareOptions): TripFare {
  return createFareBook(rules, opts).trip(segments);
}
