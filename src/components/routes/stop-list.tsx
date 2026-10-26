import { cn } from "@/lib/utils";
import type { RouteStop } from "@/lib/validation/route";

/** Ordered stops as a numbered vertical timeline. First is the start (teal), last is the end (gold). */
export function StopList({ stops }: { stops: readonly RouteStop[] }) {
  if (stops.length === 0) {
    return <p className="text-sm text-muted-foreground">No stops have been recorded for this route.</p>;
  }
  const last = stops.length - 1;
  return (
    <ol className="relative">
      {stops.map((stop, i) => {
        const role = i === 0 ? "Start" : i === last ? "End" : null;
        return (
          <li key={stop.id} className="relative flex min-h-9 gap-3 pb-3 last:pb-0">
            {i < last && <span aria-hidden="true" className="absolute top-6 -bottom-0.5 left-[11px] w-0.5 bg-border" />}
            <span
              aria-hidden="true"
              className={cn(
                "relative z-[1] flex size-6 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold",
                i === 0 && "border-foreground bg-primary text-primary-foreground",
                i === last && last !== 0 && "border-foreground bg-gold text-gold-foreground",
                role === null && "border-primary bg-card text-foreground",
              )}
            >
              {i + 1}
            </span>
            <div className="min-w-0 pt-0.5">
              <p className="text-sm font-medium break-words">
                <span className="sr-only">Stop {i + 1}: </span>
                {stop.name}
              </p>
              {role && <p className="text-xs font-medium text-muted-foreground">{role} point</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
