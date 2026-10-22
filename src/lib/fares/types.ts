import type { FareCategory } from "@/lib/validation/route";
import type { VerificationStatus } from "@/lib/validation/transport";

/**
 * Types for the fare calculator. The calculator is pure: it is given fare rules
 * (loaded from the database elsewhere) and returns a result. It never performs
 * I/O, never reads the clock, and never invents a price.
 */

/** Rule states the calculator will price from. Production uses only "verified". */
export type AcceptedStatus = Extract<VerificationStatus, "verified" | "sample">;
/** Every state a caller may opt into (e.g. an administrator previewing drafts). */
export type UsableStatus = Extract<VerificationStatus, "verified" | "unverified" | "sample">;

/** One stored fare rule. A flat route fare has both stops null. */
export type FareRule = {
  /** Present for rules loaded from the database. */
  id?: string;
  routeId: string;
  /** Both null for a flat fare on the whole route. */
  fromStopId: string | null;
  toStopId: string | null;
  category: FareCategory;
  /** Pesos, at most two decimals. Converted to integer centavos before any arithmetic. */
  amount: number;
  /** Defaults to PHP when absent. Anything else is rejected. */
  currency?: string;
  /** YYYY-MM-DD, Asia/Manila calendar dates. */
  effectiveFrom: string;
  effectiveUntil: string | null;
  status: VerificationStatus;
  /** Where the fare came from (an administrator's note), if recorded. */
  source?: string | null;
  /** When the fare was last verified (ISO timestamp), if it was. */
  verifiedAt?: string | null;
};
/** The search engine's name for the same thing. */
export type RawFare = FareRule;

export type FareUnavailableReason =
  | "invalid-segment"
  | "no-fare-record"
  | "no-fare-for-category"
  | "fare-not-verified"
  | "fare-not-in-force"
  | "conflicting-fare-rules"
  | "invalid-fare-record";

/** The fare for one ridden segment, or why there is none. */
export type LegFare =
  | {
      status: "known";
      /** Pesos (exactly centavos / 100). */
      amount: number;
      category: FareCategory;
      basis: "stop-to-stop" | "flat";
      dataStatus: UsableStatus;
      effectiveFrom: string;
      effectiveUntil: string | null;
      ruleId: string | null;
      /** Recorded source of the rule, if any. */
      source: string | null;
      /** When the rule was verified (ISO timestamp), if it was. */
      verifiedAt: string | null;
    }
  | { status: "unavailable"; reason: FareUnavailableReason };

export type FareAvailability = "flat" | "by-stop-pair" | "none";

/** Ride-level totals, as the search engine reports them. */
export type FareSummary =
  | { status: "complete"; total: number; currency: "PHP"; breakdown: { routeId: string; routeName: string; amount: number }[] }
  | {
      status: "incomplete";
      /** Sum of the segments whose fare is known. Not a total. */
      knownSubtotal: number;
      currency: "PHP";
      missing: { routeId: string; routeName: string; reason: Extract<LegFare, { status: "unavailable" }>["reason"] }[];
    };

/** One segment of a trip: one route, boarded at one stop and left at another. */
export type FareSegment = {
  routeId: string;
  routeName?: string;
  boardingStopId: string;
  dropoffStopId: string;
  /** Display names, optional; carried through to the result. */
  boardingStopName?: string;
  dropoffStopName?: string;
};

export type TripFareSegment = FareSegment & { fare: LegFare };

/** Whether a fare is confirmed, provisional, or cannot be given. */
export type FareVerification = "verified" | "unverified" | "unavailable";

export type TripFare = {
  currency: "PHP";
  category: FareCategory;
  /** "unavailable" unless every segment has a fare; "verified" only if every one is verified. */
  verification: FareVerification;
  /** True when any fare used is sample data. Sample data is never real. */
  sample: boolean;
  /** Pesos; null unless every segment has a known fare. */
  total: number | null;
  /** Sum of the segments that do have a fare. Not a total. */
  knownSubtotal: number;
  segments: TripFareSegment[];
  /** Indices (into `segments`) of segments with no fare. */
  missing: number[];
  /** The oldest verification time among the fares used (ISO), if all have one. */
  verifiedAt: string | null;
  /** Distinct recorded sources of the fares used. */
  sources: string[];
};

export type FareOptions = {
  category: FareCategory;
  /** Calendar date (YYYY-MM-DD, Asia/Manila) the fare must be in force on. */
  date: string;
  /** Default: verified only. */
  acceptStatuses?: readonly UsableStatus[];
};
