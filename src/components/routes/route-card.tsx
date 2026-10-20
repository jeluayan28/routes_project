import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { VerificationBadge } from "@/components/common/verification-badge";
import { VehicleIcon } from "@/components/routes/vehicle-icon";
import { VEHICLE_LABEL } from "@/lib/format";
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

export function RouteCard({ route, selected = false, onSelect, className }: RouteCardProps) {
  const { start, end } = routeEndpoints(route);

  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-medium text-primary">
          <VehicleIcon type={route.vehicleType} className="size-4" />
          {route.code}
          <span className="sr-only">, {VEHICLE_LABEL[route.vehicleType]}</span>
        </span>
        <VerificationBadge status={route.status} />
      </div>
      <h3 className="mt-2 font-semibold">{route.name}</h3>
      <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
        <span className="font-medium text-green-700">{start ?? "Start unknown"}</span>
        <ArrowRight aria-hidden="true" className="size-3.5" />
        <span className="font-medium text-red-700">{end ?? "End unknown"}</span>
      </p>
    </>
  );

  return (
    <article
      className={cn(
        "rounded-xl border bg-card shadow-xs transition-colors",
        selected && "border-primary ring-2 ring-primary/25",
        className,
      )}
    >
      {onSelect ? (
        <button
          type="button"
          aria-pressed={selected}
          onClick={() => onSelect(route)}
          className="block w-full rounded-t-xl p-4 text-left outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring"
        >
          {body}
        </button>
      ) : (
        <div className="p-4">{body}</div>
      )}
      <div className="border-t px-4 py-2">
        <Link
          href={`/routes/${route.id}`}
          className="inline-flex items-center gap-1 rounded text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          View details
          <span className="sr-only"> for {route.name}</span>
          <ArrowRight aria-hidden="true" className="size-3.5" />
        </Link>
      </div>
    </article>
  );
}
