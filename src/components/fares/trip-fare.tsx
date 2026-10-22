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
  verified: "border-emerald-600/40 bg-emerald-50 text-emerald-900",
  unverified: "border-sky-600/40 bg-sky-50 text-sky-900",
  unavailable: "border-amber-600/40 bg-amber-50 text-amber-950",
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
    <section aria-label={`${label} fare`} className={cn("rounded-lg border px-3 py-2", STATUS_STYLE[fare.verification])}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <p className="text-sm font-medium">{label} fare</p>
        <p className="text-xs font-medium uppercase tracking-wide">{STATUS_LABEL[fare.verification]}</p>
      </div>

      {fare.total !== null ? (
        <p className="text-2xl font-semibold tabular-nums" aria-label={`Total ${label} fare ${formatPeso(fare.total)}, ${STATUS_LABEL[fare.verification]}`}>
          {formatPeso(fare.total)}
        </p>
      ) : (
        <div className="text-sm">
          <p className="font-semibold">Total fare not available</p>
          <p>
            A total is only shown when every ride has a verified {label.toLowerCase()} fare.
            {fare.knownSubtotal > 0 && <> The rides with a known fare add up to {formatPeso(fare.knownSubtotal)}, which is not the trip total.</>}
          </p>
        </div>
      )}

      <ol className="mt-2 space-y-1.5 text-sm">
        {fare.segments.map((s, i) => (
          <li key={`${s.routeId}-${i}`} className="flex flex-wrap justify-between gap-x-4">
            <span className="min-w-0">
              {fare.segments.length > 1 && <span className="font-medium">Ride {i + 1}: </span>}
              {s.routeName}
              <span className="block text-xs text-muted-foreground">
                {s.boardingStopName} to {s.dropoffStopName}
              </span>
              {s.fare.status === "known" ? <Provenance fare={s.fare} /> : <span className="block text-xs">{FARE_REASON[s.fare.reason](label.toLowerCase())}</span>}
            </span>
            <span className="tabular-nums font-medium">
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

      {fare.sample && <p className="mt-2 text-xs">Sample data: these are not real Butuan fares.</p>}
      <div className="mt-2">
        <ReportLink
          subject={`Incorrect fare (${label}) ${first?.boardingStopName ?? ""} to ${fare.segments[fare.segments.length - 1]?.dropoffStopName ?? ""}`.trim()}
          className="h-7 text-xs"
        />
      </div>
    </section>
  );
}
