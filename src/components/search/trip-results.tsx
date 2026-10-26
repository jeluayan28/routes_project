"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { ArrowRight, Footprints, List, Map as MapIcon, MapPinOff, Pencil, TriangleAlert } from "lucide-react";
import { ErrorMessage } from "@/components/common/error-message";
import { EmptyState } from "@/components/common/empty-state";
import { SampleDataBanner } from "@/components/common/sample-data-banner";
import { VerificationNotice } from "@/components/common/verification-notice";
import { TripMapLazy } from "@/components/search/trip-map-lazy";
import { VehicleIcon } from "@/components/routes/vehicle-icon";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { TripFare } from "@/components/fares/trip-fare";
import { FARE_CATEGORY_LABEL, VEHICLE_LABEL } from "@/lib/format";
import { routeColor } from "@/lib/routes/colors";
import { describeRank } from "@/lib/search/rank";
import { tripQuery, type TripParams } from "@/lib/search/params";
import type { ResolvedLocation } from "@/lib/search/locations";
import type { TripSearchResponse } from "@/lib/search/service";
import type { Journey, RideStep, WalkStep } from "@/lib/search/types";
import { cn } from "@/lib/utils";

const formatMeters = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`);
const formatDate = (iso: string) => new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeZone: "Asia/Manila" }).format(new Date(iso));
const transfersText = (n: number) => (n === 0 ? "No transfers" : `${n} transfer${n === 1 ? "" : "s"}`);

const WALK_LABEL: Record<WalkStep["purpose"], string> = {
  access: "Walk to your boarding stop",
  transfer: "Transfer",
  egress: "Walk to your destination",
};

export type TripResultsProps = {
  response: TripSearchResponse;
  params: TripParams;
  /** The search form. Shown above the results so, on large screens, both sit in the left panel. */
  form?: ReactNode;
};

export function TripResults({ response, params, form }: TripResultsProps) {
  if (response.status === "ok") return <Journeys response={response} params={params} form={form} />;
  return (
    <div className="mx-auto w-full max-w-xl space-y-6 px-4 py-6 sm:py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Find a route</h1>
      {form && <div className="rounded-2xl border bg-card p-4 shadow-xs sm:p-5">{form}</div>}
      <Outcome response={response} params={params} />
    </div>
  );
}

function Outcome({ response, params }: { response: Exclude<TripSearchResponse, { status: "ok" }>; params: TripParams }) {
  switch (response.status) {
    case "error":
      return <ErrorMessage title="Couldn't search routes" message={response.message} />;

    case "location-problem":
      return (
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-destructive/70 bg-destructive/15 p-4 text-foreground">
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
                  className="block min-h-11 rounded-xl border bg-card p-3 outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring"
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
                  className={cn(buttonVariants({ variant: "default" }), "h-11 px-4")}
                >
                  Allow {response.details.transfersNeeded} transfer{response.details.transfersNeeded === 1 ? "" : "s"}
                </Link>
              ) : undefined
            }
          />
          <p className="text-center text-sm text-muted-foreground">
            This only means no <strong>verified</strong> route was found. A service may exist that has not been added yet.{" "}
            <Link href="/explore" className="text-link underline-offset-4 hover:underline">
              Browse all routes
            </Link>
          </p>
        </div>
      );
  }
}

function Journeys({ response, params, form }: { response: Extract<TripSearchResponse, { status: "ok" }>; params: TripParams; form?: ReactNode }) {
  const [selectedId, setSelectedId] = useState(response.journeys[0]?.id ?? null);
  // Below `lg` the options and the map are separate views; from `lg` up they sit side by side.
  const [view, setView] = useState<"list" | "map">("list");
  const [editing, setEditing] = useState(false);
  const selected = response.journeys.find((j) => j.id === selectedId) ?? response.journeys[0] ?? null;
  const selectedIndex = selected ? response.journeys.indexOf(selected) : -1;
  const approximate = [response.origin, response.destination].filter((l) => l.approximate);
  const count = response.journeys.length;

  return (
    <div className="flex flex-col lg:h-[calc(100svh-3.5rem)] lg:flex-row">
      <section aria-label="Search and results" className="flex min-w-0 flex-col lg:w-[28rem] lg:shrink-0 lg:border-r xl:w-[32rem]">
        <h1 className="sr-only">Find a route</h1>
        {form && (
          <>
            <div className="hidden border-b bg-card/60 px-4 py-4 lg:block">{form}</div>
            <div className="border-b bg-card/60 px-4 py-2 lg:hidden">
              {editing ? (
                <div className="space-y-3 py-2">
                  {form}
                  <Button type="button" variant="ghost" className="h-11 w-full" onClick={() => setEditing(false)}>
                    Close search
                  </Button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="min-w-0 truncate text-sm font-medium">
                    {response.origin.label} <ArrowRight aria-hidden="true" className="inline size-3.5" /> {response.destination.label}
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-link">
                    <Pencil aria-hidden="true" className="size-3.5" />
                    Edit search
                  </span>
                </button>
              )}
            </div>
          </>
        )}

        <div role="group" aria-label="Results view" className="grid grid-cols-2 gap-1 border-b bg-background p-1.5 lg:hidden">
          {(["list", "map"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={cn(
                "inline-flex h-11 items-center justify-center gap-2 rounded-lg text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring",
                view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent",
              )}
            >
              {v === "list" ? <List aria-hidden="true" className="size-4" /> : <MapIcon aria-hidden="true" className="size-4" />}
              {v === "list" ? `Options (${count})` : "Map"}
            </button>
          ))}
        </div>

        <div className={cn("space-y-4 px-4 py-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto", view === "map" && "max-lg:hidden")}>
          {response.dataSource === "sample" && <SampleDataBanner source="sample" />}

          <div className="space-y-1">
            <h2 className="text-lg font-semibold" aria-live="polite">
              {count} {count === 1 ? "option" : "options"}
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

          <ol className="space-y-4">
            {response.journeys.map((journey, i) => (
              <li key={journey.id}>
                <JourneyCard
                  journey={journey}
                  index={i}
                  params={params}
                  selected={journey.id === selected?.id}
                  onSelect={() => {
                    setSelectedId(journey.id);
                    setView("map");
                  }}
                />
              </li>
            ))}
          </ol>

          <ul className="space-y-1 text-sm text-muted-foreground">
            {response.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
            {[response.origin, response.destination].some((l) => l.source === "geocoder") && <li>Place search by OpenStreetMap Nominatim, © OpenStreetMap contributors.</li>}
          </ul>
          <VerificationNotice />
        </div>
      </section>

      <div className={cn("relative min-w-0 flex-1 max-lg:h-[calc(100svh-3.5rem-4.5rem)] max-lg:min-h-80 lg:min-h-0", view === "list" && "max-lg:hidden")}>
        {selected && (
          <p className="pointer-events-none absolute inset-x-0 bottom-7 z-[500] mx-auto w-fit max-w-[calc(100%-1.5rem)] truncate rounded-full border bg-background/95 px-3 py-1.5 text-sm font-medium shadow-sm lg:hidden">
            Option {selectedIndex + 1} · {transfersText(selected.summary.transfers)}
          </p>
        )}
        <TripMapLazy
          journey={selected}
          origin={response.origin}
          destination={response.destination}
          label={selected ? `Map of option ${selectedIndex + 1}` : "Map"}
          className="h-full w-full"
        />
      </div>
    </div>
  );
}

function PlaceName({ place }: { place: ResolvedLocation }) {
  return <span className="font-medium text-foreground">{place.label}</span>;
}

function JourneyCard({ journey, index, params, selected, onSelect }: { journey: Journey; index: number; params: TripParams; selected: boolean; onSelect: () => void }) {
  const rides = journey.steps.filter((s): s is RideStep => s.type === "ride");
  const headingId = `journey-${index}`;
  const rank = describeRank(journey, params.preference);
  const transfers = transfersText(journey.summary.transfers);
  let rideNumber = 0;
  return (
    <article aria-labelledby={headingId} className={cn("rounded-xl border bg-card p-4 shadow-xs", selected && "border-primary ring-2 ring-primary/25")}>
      <header className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <h3 id={headingId} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 font-semibold">
            Option {index + 1}
            {rides.map((r) => (
              <span key={r.routeId} className="inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-sm font-medium">
                <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ background: routeColor(r.routeId) }} />
                <span className="truncate">{r.routeCode}</span>
              </span>
            ))}
          </h3>
          <button
            type="button"
            aria-pressed={selected}
            onClick={onSelect}
            className={cn(buttonVariants({ variant: selected ? "default" : "outline", size: "sm" }), "h-10 shrink-0 cursor-pointer px-3 text-sm")}
          >
            {selected ? "Shown on map" : "Show on map"}
            <span className="sr-only"> for option {index + 1}</span>
          </button>
        </div>
        <p className="text-sm text-muted-foreground">
          {rank !== transfers && `${rank} · `}
          {transfers}
          {journey.summary.walkingMeters > 0 && ` · about ${formatMeters(journey.summary.walkingMeters)} walking`}
        </p>
        <TripFare journey={journey} category={params.category} />
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline" className={journey.verification.dataStatus === "verified" ? "border-primary/50 bg-primary/10 text-foreground" : "border-dashed text-foreground"}>
            {journey.verification.dataStatus === "verified" ? "Verified routes" : "Sample data"}
          </Badge>
          {journey.verification.oldestVerifiedAt && <Badge variant="outline">Verified {formatDate(journey.verification.oldestVerifiedAt)}</Badge>}
          {journey.verification.walking === "estimated" && <Badge variant="outline">Walking is an estimate</Badge>}
          <Badge variant="outline">No travel time available</Badge>
        </div>
      </header>

      <ol className="mt-5">
        {journey.steps.map((step, i) => {
          const last = i === journey.steps.length - 1;
          const rail = !last && <span aria-hidden="true" className="absolute top-7 -bottom-1 left-[11px] w-0.5 bg-border" />;
          if (step.type === "walk") {
            return (
              <li key={i} className="relative pb-4 pl-9 last:pb-0">
                {rail}
                <span aria-hidden="true" className="absolute top-0.5 left-0 flex size-6 items-center justify-center rounded-full border-2 border-border bg-card text-muted-foreground">
                  <Footprints className="size-3" />
                </span>
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{WALK_LABEL[step.purpose]}</p>
                <p className="text-sm break-words">{step.instruction}</p>
              </li>
            );
          }
          rideNumber += 1;
          return (
            <li key={i} className="relative pb-4 pl-9 last:pb-0">
              {rail}
              <span aria-hidden="true" className="absolute top-0.5 left-0 flex size-6 items-center justify-center rounded-full text-xs font-semibold text-white" style={{ background: routeColor(step.routeId) }}>
                {rideNumber}
              </span>
              <div className="min-w-0 space-y-1 text-sm">
                <p className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  <VehicleIcon type={step.transportType} className="size-3.5" />
                  {VEHICLE_LABEL[step.transportType]} · {step.direction === "outbound" ? "outbound" : "inbound"} direction
                </p>
                <p className="font-medium break-words">{step.instruction}</p>
                {step.alsoServedBy.length > 0 && (
                  <p className="text-muted-foreground">Same stops and fare: {step.alsoServedBy.map((r) => r.routeCode).join(", ")}.</p>
                )}
                {step.intermediateStops.length > 0 && (
                  <details>
                    <summary className="flex min-h-10 cursor-pointer items-center text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      Stops along the way ({step.intermediateStops.length})
                    </summary>
                    <ol className="mt-1 list-decimal pl-5">
                      {step.intermediateStops.map((name, k) => (
                        <li key={k}>{name}</li>
                      ))}
                    </ol>
                  </details>
                )}
                {step.geometry.status === "unavailable" && <p className="text-muted-foreground">The path for this ride is not shown on the map.</p>}
              </div>
            </li>
          );
        })}
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
