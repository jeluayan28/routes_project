import { ChevronDown } from "lucide-react";
import { ReportLink } from "@/components/reports/report-link";
import { assembleTripFare } from "@/lib/fares/calculator";
import type { FareUnavailableReason, LegFare, TripFare as TripFareResult } from "@/lib/fares/types";
import { FARE_CATEGORY_LABEL, formatFareDate, formatPeso, formatVerifiedDate } from "@/lib/format";
import type { Journey, RideStep } from "@/lib/search/types";
import type { FareCategory } from "@/lib/validation/route";
import { cn } from "@/lib/utils";

/** Why a fare is missing, in plain words. Never suggests a price. */
export const FARE_REASON: Record<FareUnavailableReason, (category: string) => string> = {
  "invalid-segment": () => "The boarding and drop-off stops for this ride are not valid, so it cannot be priced.",
  "no-fare-record": () => "No fare has been recorded for this ride.",
  "no-fare-for-category": (c) => `No ${c} fare has been recorded for this ride.`,
  "fare-not-verified": () => "A fare exists but has not been verified, so it is not shown.",
  "fare-not-in-force": () => "The recorded fares for this ride are not in force on the travel date.",
  "conflicting-fare-rules": () => "The recorded fares for this ride disagree with each other, so none is used.",
  "invalid-fare-record": () => "The recorded fare for this ride is not valid, so it is not used.",
};

const STATUS_LABEL = { verified: "Verified", unverified: "Unverified", unavailable: "Unavailable" } as const;
const STATUS_STYLE = {
  verified: "border-gold bg-gold/20 text-foreground",
  unverified: "border-dashed border-input bg-muted/60 text-foreground",
  unavailable: "border-dashed border-input bg-card text-foreground",
} as const;

/** Prices a journey's rides as a trip: one segment per ride, a total only if all are known. */
export function tripFareOf(journey: Journey, category: FareCategory): TripFareResult {
  const rides = journey.steps.filter((s): s is RideStep => s.type === "ride");
  return assembleTripFare(
    rides.map((r) => ({
      routeId: r.routeId,
      routeName: `${r.routeCode} · ${r.routeName}`,
      boardingStopId: r.board.stopId,
      dropoffStopId: r.alight.stopId,
      boardingStopName: r.board.name,
      dropoffStopName: r.alight.name,
      fare: r.fare,
    })),
    { category },
  );
}

function Provenance({ fare }: { fare: Extract<LegFare, { status: "known" }> }) {
  return (
    <span className="block text-xs text-muted-foreground">
      {fare.dataStatus === "verified"
        ? fare.verifiedAt
          ? `Verified ${formatFareDate(fare.verifiedAt)}`
          : "Verified (date not recorded)"
        : fare.dataStatus === "sample"
          ? "Sample data, not a real fare"
          : "Not verified"}
      {fare.source ? ` · Source: ${fare.source}` : " · Source not recorded"}
      {` · in force from ${formatVerifiedDate(fare.effectiveFrom)}`}
      {fare.effectiveUntil ? ` to ${formatVerifiedDate(fare.effectiveUntil)}` : ""}
    </span>
  );
}

/**
 * The fare for a journey: a prominent total when every segment is known, a
 * per-segment breakdown, a verified / unverified / unavailable label with the
 * verification date and source, and a way to report a wrong fare.
 */
export function TripFare({ journey, category }: { journey: Journey; category: FareCategory }) {
  const fare = tripFareOf(journey, category);
  const label = FARE_CATEGORY_LABEL[category];
  const first = fare.segments[0];

  return (
    <section aria-label={`${label} fare`} className={cn("rounded-lg border px-3 py-2.5", STATUS_STYLE[fare.verification])}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium">{label} fare</p>
          {fare.total !== null ? (
            <p className="text-2xl leading-tight font-semibold tabular-nums" aria-label={`Total ${label} fare ${formatPeso(fare.total)}, ${STATUS_LABEL[fare.verification]}`}>
              {formatPeso(fare.total)}
            </p>
          ) : (
            <p className="text-sm font-semibold">Total fare not available</p>
          )}
        </div>
        <p className="shrink-0 rounded-full border border-current/30 px-2 py-0.5 text-xs font-semibold tracking-wide uppercase">{STATUS_LABEL[fare.verification]}</p>
      </div>

      {fare.total === null && (
        <p className="mt-1 text-sm">
          A total is only shown when every ride has a verified {label.toLowerCase()} fare.
          {fare.knownSubtotal > 0 && <> The rides with a known fare add up to {formatPeso(fare.knownSubtotal)}, which is not the trip total.</>}
        </p>
      )}

      <details className="group mt-1">
        <summary className="flex min-h-10 cursor-pointer items-center gap-1 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Fare breakdown
          <ChevronDown aria-hidden="true" className="size-4 transition-transform group-open:rotate-180" />
        </summary>
        <ol className="mt-1 space-y-2 text-sm">
          {fare.segments.map((s, i) => (
            <li key={`${s.routeId}-${i}`} className="flex flex-wrap justify-between gap-x-4 border-t border-current/15 pt-2">
              <span className="min-w-0 break-words">
                {fare.segments.length > 1 && <span className="font-medium">Ride {i + 1}: </span>}
                {s.routeName}
                <span className="block text-xs text-muted-foreground">
                  {s.boardingStopName} to {s.dropoffStopName}
                </span>
                {s.fare.status === "known" ? <Provenance fare={s.fare} /> : <span className="block text-xs">{FARE_REASON[s.fare.reason](label.toLowerCase())}</span>}
              </span>
              <span className="font-medium tabular-nums">
                {s.fare.status === "known" ? (
                  <>
                    {formatPeso(s.fare.amount)}
                    {s.fare.basis === "flat" && <span className="block text-xs font-normal text-muted-foreground">flat route fare</span>}
                  </>
                ) : (
                  "Unavailable"
                )}
              </span>
            </li>
          ))}
        </ol>
      </details>

      {fare.sample && <p className="text-xs">Sample data: these are not real Butuan fares.</p>}
      <div className="mt-1">
        <ReportLink type="incorrect_fare" routeId={first?.routeId} className="h-9 text-xs" />
      </div>
    </section>
  );
}
