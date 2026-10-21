"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Footprints, MapPinOff, TriangleAlert } from "lucide-react";
import { ErrorMessage } from "@/components/common/error-message";
import { EmptyState } from "@/components/common/empty-state";
import { SampleDataBanner } from "@/components/common/sample-data-banner";
import { TripMapLazy } from "@/components/search/trip-map-lazy";
import { VehicleIcon } from "@/components/routes/vehicle-icon";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { FARE_CATEGORY_LABEL, VEHICLE_LABEL, formatPeso } from "@/lib/format";
import { routeColor } from "@/lib/routes/colors";
import { describeRank } from "@/lib/search/rank";
import { tripQuery, type TripParams } from "@/lib/search/params";
import type { ResolvedLocation } from "@/lib/search/locations";
import type { TripSearchResponse } from "@/lib/search/service";
import type { Journey, LegFare, RideStep } from "@/lib/search/types";
import { cn } from "@/lib/utils";

const FARE_REASON: Record<Extract<LegFare, { status: "unavailable" }>["reason"], (category: string) => string> = {
  "no-fare-record": () => "No fare has been recorded for this ride.",
  "no-fare-for-category": (c) => `No ${c} fare has been recorded for this ride.`,
  "fare-not-verified": () => "A fare exists but has not been verified, so it is not shown.",
};

const formatMeters = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`);
const formatDate = (iso: string) => new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeZone: "Asia/Manila" }).format(new Date(iso));

export function TripResults({ response, params }: { response: TripSearchResponse; params: TripParams }) {
  switch (response.status) {
    case "error":
      return <ErrorMessage title="Couldn't search routes" message={response.message} />;

    case "location-problem":
      return (
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-amber-600/40 bg-amber-50 p-4 text-amber-950">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          <div>
            <p className="font-medium">
              {response.end === "origin" ? "Starting point" : "Destination"}: {response.message}
            </p>
            <p className="mt-1 text-sm">
              You can also type coordinates such as <code>8.95, 125.54</code>.
            </p>
          </div>
        </div>
      );

    case "needs-choice": {
      const key = response.end === "origin" ? "from" : "to";
      return (
        <section aria-labelledby="choice-heading" className="space-y-3">
          <h2 id="choice-heading" className="text-lg font-semibold">
            Which “{response.typed}” do you mean?
          </h2>
          <p className="text-sm text-muted-foreground">More than one place matches your {response.end === "origin" ? "starting point" : "destination"}. Pick one.</p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {response.candidates.map((c) => (
              <li key={c.ref}>
                <Link
                  href={`/search?${tripQuery({ ...params, [key]: c.ref })}`}
                  className="block rounded-xl border bg-card p-3 outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="font-medium">{c.label}</span>
                  {c.detail && <span className="block text-sm text-muted-foreground">{c.detail}</span>}
                </Link>
              </li>
            ))}
          </ul>
          {response.candidates.some((c) => c.source === "geocoder") && (
            <p className="text-xs text-muted-foreground">Place search results are from OpenStreetMap contributors and are approximate.</p>
          )}
        </section>
      );
    }

    case "no-journey":
      return (
        <div className="space-y-4">
          {response.dataSource === "sample" && <SampleDataBanner source="sample" />}
          <EmptyState
            icon={MapPinOff}
            title="No journey found"
            description={response.message}
            action={
              response.reason === "transfer-limit" && response.details.transfersNeeded !== undefined ? (
                <Link
                  href={`/search?${tripQuery({ ...params, maxTransfers: response.details.transfersNeeded })}`}
                  className={buttonVariants({ variant: "default" })}
                >
                  Allow {response.details.transfersNeeded} transfer{response.details.transfersNeeded === 1 ? "" : "s"}
                </Link>
              ) : undefined
            }
          />
          <p className="text-center text-sm text-muted-foreground">
            This only means no <strong>verified</strong> route was found. A service may exist that has not been added yet.{" "}
            <Link href="/explore" className="text-primary underline-offset-4 hover:underline">
              Browse all routes
            </Link>
          </p>
        </div>
      );

    case "ok":
      return <Journeys response={response} params={params} />;
  }
}

function Journeys({ response, params }: { response: Extract<TripSearchResponse, { status: "ok" }>; params: TripParams }) {
  const [selectedId, setSelectedId] = useState(response.journeys[0]?.id ?? null);
  const selected = response.journeys.find((j) => j.id === selectedId) ?? response.journeys[0] ?? null;
  const approximate = [response.origin, response.destination].filter((l) => l.approximate);

  return (
    <div className="space-y-4">
      {response.dataSource === "sample" && <SampleDataBanner source="sample" />}

      <div className="space-y-1">
        <h2 className="text-lg font-semibold" aria-live="polite">
          {response.journeys.length} {response.journeys.length === 1 ? "option" : "options"}
        </h2>
        <p className="text-sm text-muted-foreground">
          <PlaceName place={response.origin} /> <ArrowRight aria-hidden="true" className="inline size-3.5" /> <PlaceName place={response.destination} /> ·{" "}
          {FARE_CATEGORY_LABEL[params.category]} fare
        </p>
        {approximate.map((l) => (
          <p key={l.label} className="text-sm text-muted-foreground">
            We read your entry as <strong>{l.label}</strong>.
          </p>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <ol className="space-y-4">
          {response.journeys.map((journey, i) => (
            <li key={journey.id}>
              <JourneyCard
                journey={journey}
                index={i}
                params={params}
                selected={journey.id === selected?.id}
                onSelect={() => setSelectedId(journey.id)}
              />
            </li>
          ))}
        </ol>
        <div className="order-first h-72 overflow-hidden rounded-2xl border shadow-xs lg:sticky lg:top-20 lg:order-none lg:h-[calc(100svh-7rem)]">
          <TripMapLazy
            journey={selected}
            origin={response.origin}
            destination={response.destination}
            label={selected ? `Map of option ${response.journeys.indexOf(selected) + 1}` : "Map"}
            className="h-full w-full"
          />
        </div>
      </div>

      <ul className="space-y-1 text-sm text-muted-foreground">
        {response.notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
        {[response.origin, response.destination].some((l) => l.source === "geocoder") && <li>Place search by OpenStreetMap Nominatim, © OpenStreetMap contributors.</li>}
      </ul>
    </div>
  );
}

function PlaceName({ place }: { place: ResolvedLocation }) {
  return <span className="font-medium text-foreground">{place.label}</span>;
}

function JourneyCard({ journey, index, params, selected, onSelect }: { journey: Journey; index: number; params: TripParams; selected: boolean; onSelect: () => void }) {
  const rides = journey.steps.filter((s): s is RideStep => s.type === "ride");
  const headingId = `journey-${index}`;
  return (
    <article aria-labelledby={headingId} className={cn("rounded-2xl border bg-card p-4 shadow-xs", selected && "border-primary ring-2 ring-primary/25")}>
      <header className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id={headingId} className="flex flex-wrap items-center gap-2 font-semibold">
            Option {index + 1}
            {rides.map((r) => (
              <span key={r.routeId} className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-sm font-medium">
                <span aria-hidden="true" className="size-2.5 rounded-full" style={{ background: routeColor(r.routeId) }} />
                {r.routeCode}
              </span>
            ))}
          </h3>
          <button
            type="button"
            aria-pressed={selected}
            onClick={onSelect}
            className={cn(buttonVariants({ variant: selected ? "default" : "outline", size: "sm" }), "cursor-pointer")}
          >
            {selected ? "Shown on map" : "Show on map"}
            <span className="sr-only"> for option {index + 1}</span>
          </button>
        </div>
        <p className="text-sm text-muted-foreground">
          {describeRank(journey, params.preference)} · {journey.summary.transfers === 0 ? "No transfers" : `${journey.summary.transfers} transfer${journey.summary.transfers === 1 ? "" : "s"}`}
          {journey.summary.walkingMeters > 0 && ` · about ${formatMeters(journey.summary.walkingMeters)} walking`}
        </p>
        <Fare journey={journey} category={params.category} />
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline" className={journey.verification.dataStatus === "verified" ? "border-emerald-600/40 bg-emerald-50 text-emerald-900" : "border-sky-600/40 bg-sky-50 text-sky-900"}>
            {journey.verification.dataStatus === "verified" ? "Verified routes" : "Sample data"}
          </Badge>
          {journey.verification.oldestVerifiedAt && <Badge variant="outline">Verified {formatDate(journey.verification.oldestVerifiedAt)}</Badge>}
          {journey.verification.walking === "estimated" && <Badge variant="outline">Walking is an estimate</Badge>}
          <Badge variant="outline">No travel time available</Badge>
        </div>
      </header>

      <ol className="mt-4 space-y-3">
        {journey.steps.map((step, i) =>
          step.type === "walk" ? (
            <li key={i} className="flex gap-3 text-sm">
              <Footprints aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <p>{step.instruction}</p>
            </li>
          ) : (
            <li key={i} className="flex gap-3">
              <span aria-hidden="true" className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-white" style={{ background: routeColor(step.routeId) }}>
                <VehicleIcon type={step.transportType} className="size-3" />
              </span>
              <div className="min-w-0 space-y-1 text-sm">
                <p className="font-medium">{step.instruction}</p>
                <p className="text-muted-foreground">{VEHICLE_LABEL[step.transportType]} · {step.direction === "outbound" ? "outbound" : "inbound"} direction</p>
                {step.alsoServedBy.length > 0 && (
                  <p className="text-muted-foreground">Same stops and fare: {step.alsoServedBy.map((r) => r.routeCode).join(", ")}.</p>
                )}
                {step.intermediateStops.length > 0 && (
                  <details>
                    <summary className="cursor-pointer text-muted-foreground">Stops along the way ({step.intermediateStops.length})</summary>
                    <ol className="mt-1 list-decimal pl-5">
                      {step.intermediateStops.map((name, k) => (
                        <li key={k}>{name}</li>
                      ))}
                    </ol>
                  </details>
                )}
                <p>
                  {step.fare.status === "known" ? (
                    <>Fare {formatPeso(step.fare.amount)}{step.fare.basis === "flat" ? " (flat route fare)" : ""}</>
                  ) : (
                    <span className="text-amber-800">{FARE_REASON[step.fare.reason](FARE_CATEGORY_LABEL[params.category].toLowerCase())}</span>
                  )}
                </p>
                {step.geometry.status === "unavailable" && <p className="text-muted-foreground">The path for this ride is not shown on the map.</p>}
              </div>
            </li>
          ),
        )}
      </ol>

      {journey.notes.length > 0 && (
        <ul className="mt-3 space-y-1 border-t pt-3 text-xs text-muted-foreground">
          {journey.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </article>
  );
}

function Fare({ journey, category }: { journey: Journey; category: TripParams["category"] }) {
  const fare = journey.fare;
  if (fare.status === "complete") {
    return (
      <div>
        <p className="text-2xl font-semibold tabular-nums">{formatPeso(fare.total)}</p>
        {fare.breakdown.length > 1 && (
          <dl className="mt-1 space-y-0.5 text-sm text-muted-foreground">
            {fare.breakdown.map((b, i) => (
              <div key={`${b.routeId}${i}`} className="flex justify-between gap-4">
                <dt>{b.routeName}</dt>
                <dd className="tabular-nums">{formatPeso(b.amount)}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-amber-600/40 bg-amber-50 px-3 py-2 text-sm text-amber-950">
      <p className="font-medium">Total fare not available</p>
      <p>
        We don&apos;t have a verified {FARE_CATEGORY_LABEL[category].toLowerCase()} fare for {fare.missing.map((m) => m.routeName).join(", ")}.
        {fare.knownSubtotal > 0 && <> The other segments cost {formatPeso(fare.knownSubtotal)}.</>}
      </p>
    </div>
  );
}
