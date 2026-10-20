import { cn } from "@/lib/utils";
import type { RouteStop } from "@/lib/validation/route";

/** Ordered stops: first is the start (green), last is the end (red). */
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
          <li key={stop.id} className="relative flex gap-3 pb-4 last:pb-0">
            {i < last && (
              <span aria-hidden="true" className="absolute top-4 bottom-0 left-[7px] w-0.5 bg-primary/30" />
            )}
            <span
              aria-hidden="true"
              className={cn(
                "relative z-[1] mt-1 size-4 shrink-0 rounded-full border-2 border-background ring-2",
                i === 0 && "bg-green-600 ring-green-600",
                i === last && last !== 0 && "bg-red-600 ring-red-600",
                role === null && "bg-background ring-primary",
              )}
            />
            <div>
              <p className="text-sm font-medium">
                <span className="sr-only">Stop {i + 1}: </span>
                {stop.name}
              </p>
              {role && (
                <p className={cn("text-xs font-medium", role === "Start" ? "text-green-700" : "text-red-700")}>
                  {role} point
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
