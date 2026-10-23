import Link from "next/link";
import { ArrowLeftRight, ArrowRight, Receipt } from "lucide-react";
import { LastVerified } from "@/components/common/last-verified";
import { VerificationBadge } from "@/components/common/verification-badge";
import { FareBadge } from "@/components/fares/fare-badge";
import { ReportLink } from "@/components/reports/report-link";
import { DirectionStops } from "@/components/routes/direction-stops";
import { VehicleIcon } from "@/components/routes/vehicle-icon";
import { buttonVariants } from "@/components/ui/button";
import { VEHICLE_LABEL } from "@/lib/format";
import { routeEndpoints } from "@/lib/routes/filter";
import { routeColor } from "@/lib/routes/colors";
import type { DirectionKind, Route } from "@/lib/validation/route";

type RouteDetailsPanelProps = {
  route: Route;
  /** "summary" fits the explore sidebar; "full" is the details page. */
  variant?: "summary" | "full";
  headingLevel?: "h1" | "h2";
  /** Direction whose stops are listed. Leave out for the panel to manage it. */
  direction?: DirectionKind;
  onDirectionChange?: (kind: DirectionKind) => void;
};

export function RouteDetailsPanel({
  route,
  variant = "full",
  headingLevel = "h2",
  direction,
  onDirectionChange,
}: RouteDetailsPanelProps) {
  const { start, end } = routeEndpoints(route);
  const Heading = headingLevel;
  const full = variant === "full";

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="flex items-center gap-2 text-sm font-medium text-primary">
          <span aria-hidden="true" className="size-3 shrink-0 rounded-full" style={{ background: routeColor(route.id) }} />
          <VehicleIcon type={route.vehicleType} className="size-4" />
          {VEHICLE_LABEL[route.vehicleType]} · {route.code}
        </p>
        <Heading className={full ? "text-2xl font-semibold tracking-tight" : "text-lg font-semibold"}>
          {route.name}
        </Heading>
        <VerificationBadge status={route.status} />
        {route.status !== "sample" && <LastVerified at={route.lastVerifiedAt} />}
      </header>

      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div className="rounded-lg border border-green-600/25 bg-green-50 px-3 py-2">
          <dt className="text-xs font-medium text-green-800">Starting point</dt>
          <dd className="font-medium">{start ?? "Not recorded"}</dd>
        </div>
        <div className="rounded-lg border border-red-600/25 bg-red-50 px-3 py-2">
          <dt className="text-xs font-medium text-red-800">Ending point</dt>
          <dd className="font-medium">{end ?? "Not recorded"}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            {route.direction === "both" ? (
              <ArrowLeftRight aria-hidden="true" className="size-3.5" />
            ) : (
              <ArrowRight aria-hidden="true" className="size-3.5" />
            )}
            Direction
          </dt>
          <dd>
            {route.direction === "both" ? "Both directions" : "One-way (start to end)"}
            {route.directionNote && (
              <span className="block text-muted-foreground">{route.directionNote}</span>
            )}
          </dd>
        </div>
      </dl>

      {full && (
        <section aria-labelledby="fares-heading" className="space-y-3">
          <h2 id="fares-heading" className="flex items-center gap-2 font-semibold">
            <Receipt aria-hidden="true" className="size-4" />
            Fares
          </h2>
          {route.fares.length === 0 ? (
            <p className="rounded-lg border border-dashed px-3 py-3 text-sm text-muted-foreground">
              No fare information has been recorded for this route yet.
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {route.fares.map((fare) => (
                <FareBadge key={fare.id} fare={fare} />
              ))}
            </div>
          )}
          {!route.fares.some((f) => f.status === "verified") && route.fares.length > 0 && (
            <p className="text-sm text-muted-foreground">
              None of these fares are verified. Do not rely on them.
            </p>
          )}
        </section>
      )}

      <section aria-labelledby={`stops-heading-${route.id}`} className="space-y-3">
        <h2 id={`stops-heading-${route.id}`} className="font-semibold">
          Stops
        </h2>
        <DirectionStops directions={route.directions} value={direction} onValueChange={onDirectionChange} />
      </section>

      <div className="flex flex-wrap gap-2">
        {!full && (
          <Link href={`/routes/${route.id}`} className={buttonVariants({ variant: "default" })}>
            View full details
          </Link>
        )}
        <ReportLink type="incorrect_route" routeId={route.id} />
      </div>
    </div>
  );
}
