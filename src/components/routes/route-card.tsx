import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { VerificationBadge } from "@/components/common/verification-badge";
import { VehicleIcon } from "@/components/routes/vehicle-icon";
import { formatPeso, VEHICLE_LABEL } from "@/lib/format";
import { routeColor } from "@/lib/routes/colors";
import { routeEndpoints } from "@/lib/routes/filter";
import { cn } from "@/lib/utils";
import type { Route } from "@/lib/validation/route";

export type RouteCardProps = {
  route: Route;
  selected?: boolean;
  /** When provided, the card body becomes a button that selects the route. */
  onSelect?: (route: Route) => void;
  className?: string;
};

/** The regular fare, only when a verified one is recorded. Anything else is labelled as such. */
function FareChip({ route }: { route: Route }) {
  const verified = route.fares.find((f) => f.category === "regular" && f.status === "verified");
  if (verified) {
    return (
      <span className="inline-flex items-center rounded-md bg-gold px-2 py-0.5 text-sm font-semibold text-gold-foreground tabular-nums">
        {formatPeso(verified.amount)}
        <span className="sr-only"> regular fare, verified</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-md border border-dashed px-2 py-0.5 text-xs font-medium text-muted-foreground">
      {route.fares.length === 0 ? "No fare recorded" : "Fare not verified"}
    </span>
  );
}

export function RouteCard({ route, selected = false, onSelect, className }: RouteCardProps) {
  const { start, end } = routeEndpoints(route);
  const stopCount = route.directions[0].stops.length;

  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
          <span aria-hidden="true" className="size-3 shrink-0 rounded-full" style={{ background: routeColor(route.id) }} />
          <VehicleIcon type={route.vehicleType} className="size-4 shrink-0" />
          <span className="truncate">{route.code}</span>
          <span className="sr-only">, {VEHICLE_LABEL[route.vehicleType]}</span>
        </span>
        <VerificationBadge status={route.status} />
      </div>
      <h3 className="mt-2 font-semibold break-words">{route.name}</h3>
      <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{start ?? "Start unknown"}</span>
        <ArrowRight aria-hidden="true" className="size-3.5 shrink-0 text-primary" />
        <span className="font-medium text-foreground">{end ?? "End unknown"}</span>
      </p>
      <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
        <FareChip route={route} />
        <span>{VEHICLE_LABEL[route.vehicleType]}</span>
        {stopCount > 0 && <span>{stopCount} stops</span>}
      </p>
    </>
  );

  return (
    <article
      className={cn(
        "overflow-hidden rounded-xl border bg-card shadow-xs transition-colors",
        selected && "border-primary ring-2 ring-primary/30",
        className,
      )}
    >
      {onSelect ? (
        <button
          type="button"
          aria-pressed={selected}
          onClick={() => onSelect(route)}
          className="block w-full p-4 text-left outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          {body}
        </button>
      ) : (
        <div className="p-4">{body}</div>
      )}
      <Link
        href={`/routes/${route.id}`}
        className="flex min-h-11 items-center justify-between gap-1 border-t px-4 text-sm font-medium text-link outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <span>
          View details
          <span className="sr-only"> for {route.name}</span>
        </span>
        <ArrowRight aria-hidden="true" className="size-4" />
      </Link>
    </article>
  );
}
