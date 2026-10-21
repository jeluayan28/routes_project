import { toCentavos } from "@/lib/search/fares";
import type { Journey, Preference } from "@/lib/search/types";

type Keys = {
  transfers: number;
  walking: number;
  riding: number;
  /** Number of ridden segments with no known fare. */
  missingFares: number;
  /** Sum of the known segment fares in centavos (a true total only when nothing is missing). */
  fareKnown: number;
};

const keys = (j: Journey): Keys => {
  const missingFares = j.fare.status === "complete" ? 0 : j.fare.missing.length;
  const fareKnown = toCentavos(j.fare.status === "complete" ? j.fare.total : j.fare.knownSubtotal);
  return {
    transfers: j.summary.transfers,
    walking: j.summary.walkingMeters,
    riding: j.summary.stopsTravelled,
    missingFares,
    fareKnown,
  };
};

/**
 * Sort keys per preference, most important first. A journey whose fare is not
 * fully known always ranks after one whose fare is, whatever the preference,
 * when fare is what is being compared: an unknown fare is never treated as cheap.
 */
const ORDER: Record<Preference, (k: Keys) => number[]> = {
  "lowest-fare": (k) => [k.missingFares > 0 ? 1 : 0, k.missingFares, k.fareKnown, k.transfers, k.walking, k.riding],
  "fewest-transfers": (k) => [k.transfers, k.walking, k.missingFares > 0 ? 1 : 0, k.fareKnown, k.riding],
  "shortest-walking": (k) => [k.walking, k.transfers, k.missingFares > 0 ? 1 : 0, k.fareKnown, k.riding],
};

/** Negative if `a` ranks before `b`. Ties break on the journey id so output is deterministic. */
export function compareJourneys(a: Journey, b: Journey, preference: Preference): number {
  const ka = ORDER[preference](keys(a));
  const kb = ORDER[preference](keys(b));
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
  return a.id.localeCompare(b.id);
}

/** Why a journey ranks where it does, in words. */
export function describeRank(j: Journey, preference: Preference): string {
  const k = keys(j);
  switch (preference) {
    case "lowest-fare":
      return j.fare.status === "complete" ? `Total fare ₱${j.fare.total.toFixed(2)}` : "Fare not fully known";
    case "shortest-walking":
      return `About ${k.walking} m of walking`;
    default:
      return k.transfers === 0 ? "No transfers" : `${k.transfers} transfer${k.transfers === 1 ? "" : "s"}`;
  }
}

const fareNoWorse = (a: Journey, b: Journey): boolean => {
  if (a.fare.status === "complete") return b.fare.status === "incomplete" || a.fare.total <= b.fare.total;
  return b.fare.status === "incomplete" && a.fare.missing.length <= b.fare.missing.length;
};

/**
 * `a` makes `b` redundant: `a` uses only routes that `b` also uses (and `b` uses
 * more), and is no worse on transfers, walking and fare. This removes results
 * like "take route 1, then transfer to route 2" when route 2 alone does the trip.
 */
export function dominates(a: Journey, b: Journey): boolean {
  const ra = new Set(a.summary.routeIds);
  const rb = new Set(b.summary.routeIds);
  if (ra.size >= rb.size || ![...ra].every((r) => rb.has(r))) return false;
  return a.summary.transfers <= b.summary.transfers && a.summary.walkingMeters <= b.summary.walkingMeters && fareNoWorse(a, b);
}
