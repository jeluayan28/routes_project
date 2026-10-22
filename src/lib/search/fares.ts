import { createFareBook } from "@/lib/fares/calculator";
import type { AcceptedStatus, FareAvailability, LegFare } from "@/lib/fares/types";
import type { RawFare } from "@/lib/search/types";
import type { FareCategory } from "@/lib/validation/route";

export { fromCentavos, toCentavos } from "@/lib/fares/money";

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

/**
 * The search engine's view of the fare calculator (`src/lib/fares/`). All the
 * rules (accepted statuses, effective dates, exact stops over flat, direction,
 * no category substitution, rejection of invalid and conflicting records) live
 * there; this only adapts the call shape.
 */
export function createFareResolver(fares: readonly RawFare[], ctx: FareContext): FareResolver {
  const book = createFareBook(fares, ctx);
  return {
    resolve: (routeId, fromStopId, toStopId) => book.segment({ routeId, boardingStopId: fromStopId, dropoffStopId: toStopId }),
    availability: book.availability,
    fingerprint: book.fingerprint,
  };
}
