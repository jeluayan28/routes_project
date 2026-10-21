import type { FareCategory } from "@/lib/validation/route";
import type { AcceptedStatus, FareAvailability, LegFare, RawFare } from "@/lib/search/types";

export type FareContext = {
  category: FareCategory;
  /** YYYY-MM-DD */
  date: string;
  acceptStatuses: readonly AcceptedStatus[];
};

export type FareResolver = {
  /** Fare for riding one route from one stop to another, or why there is none. */
  resolve(routeId: string, fromStopId: string, toStopId: string): LegFare;
  /** Whether the route has any applicable fare for this category and date. */
  availability(routeId: string): FareAvailability;
  /** Identical for routes whose applicable fares are identical. */
  fingerprint(routeId: string): string;
};

const isAccepted = (status: string, accept: readonly AcceptedStatus[]): status is AcceptedStatus =>
  (accept as readonly string[]).includes(status);

const validOn = (f: RawFare, date: string) => f.effectiveFrom <= date && (f.effectiveUntil === null || f.effectiveUntil >= date);

/**
 * Fare rules, applied conservatively:
 *  - Only fares in an accepted status (production: verified) and in force on the
 *    date count. An unverified fare is never used, only reported as the reason.
 *  - A rule for the exact origin and destination wins; otherwise a flat route fare.
 *  - Direction matters: a rule for A to B does not price B to A.
 *  - The category is never substituted: if there is no student fare, a regular fare
 *    is not shown as the student fare.
 *  - If several rules match (the database prevents overlap), the latest start wins.
 */
export function createFareResolver(fares: readonly RawFare[], ctx: FareContext): FareResolver {
  const byRoute = new Map<string, RawFare[]>();
  for (const f of fares) {
    const list = byRoute.get(f.routeId);
    if (list) list.push(f);
    else byRoute.set(f.routeId, [f]);
  }
  const cache = new Map<string, LegFare>();

  const usable = (routeId: string) =>
    (byRoute.get(routeId) ?? []).filter(
      (f) => f.category === ctx.category && validOn(f, ctx.date) && isAccepted(f.status, ctx.acceptStatuses),
    );

  const latest = (rules: RawFare[]) => rules.reduce((a, b) => (b.effectiveFrom > a.effectiveFrom ? b : a));

  function resolve(routeId: string, fromStopId: string, toStopId: string): LegFare {
    const key = `${routeId}|${fromStopId}|${toStopId}`;
    const hit = cache.get(key);
    if (hit) return hit;

    const rules = usable(routeId);
    const pair = rules.filter((f) => f.fromStopId === fromStopId && f.toStopId === toStopId);
    const flat = rules.filter((f) => f.fromStopId === null && f.toStopId === null);
    const chosen = pair.length > 0 ? latest(pair) : flat.length > 0 ? latest(flat) : null;

    let result: LegFare;
    if (chosen) {
      result = {
        status: "known",
        amount: chosen.amount,
        category: ctx.category,
        basis: chosen.fromStopId === null ? "flat" : "stop-to-stop",
        dataStatus: chosen.status as AcceptedStatus,
        effectiveFrom: chosen.effectiveFrom,
      };
    } else {
      const inForce = (byRoute.get(routeId) ?? []).filter((f) => validOn(f, ctx.date));
      const accepted = inForce.filter((f) => isAccepted(f.status, ctx.acceptStatuses));
      const reason =
        inForce.length === 0
          ? "no-fare-record"
          : accepted.length === 0
            ? "fare-not-verified"
            : !accepted.some((f) => f.category === ctx.category)
              ? "no-fare-for-category"
              : "no-fare-record";
      result = { status: "unavailable", reason };
    }
    cache.set(key, result);
    return result;
  }

  return {
    resolve,
    fingerprint(routeId) {
      return usable(routeId)
        .map((f) => `${f.fromStopId ?? "*"}>${f.toStopId ?? "*"}=${toCentavos(f.amount)}@${f.effectiveFrom}`)
        .sort()
        .join(";");
    },
    availability(routeId) {
      const rules = usable(routeId);
      if (rules.some((f) => f.fromStopId === null && f.toStopId === null)) return "flat";
      return rules.length > 0 ? "by-stop-pair" : "none";
    },
  };
}

/** Integer centavos, so sums and comparisons are exact. */
export const toCentavos = (pesos: number) => Math.round(pesos * 100);
export const fromCentavos = (centavos: number) => centavos / 100;
