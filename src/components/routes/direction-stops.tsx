"use client";

import { useState } from "react";
import { StopList } from "@/components/routes/stop-list";
import { DIRECTION_LABEL } from "@/lib/routes/geometry";
import { cn } from "@/lib/utils";
import type { DirectionKind, RouteDirection } from "@/lib/validation/route";

type DirectionStopsProps = {
  directions: readonly RouteDirection[];
  /** Controlled direction. Leave out to let the component keep its own. */
  value?: DirectionKind;
  onValueChange?: (kind: DirectionKind) => void;
};

/**
 * Ordered stops for one direction at a time. Each direction has its own list,
 * so a return trip is never shown as the outbound list reversed.
 */
export function DirectionStops({ directions, value, onValueChange }: DirectionStopsProps) {
  const [own, setOwn] = useState<DirectionKind>(directions[0].kind);
  const kind = value ?? own;
  const active = directions.find((d) => d.kind === kind) ?? directions[0];

  const choose = (next: DirectionKind) => {
    setOwn(next);
    onValueChange?.(next);
  };

  return (
    <div className="space-y-3">
      {directions.length > 1 ? (
        <div role="group" aria-label="Direction" className="flex flex-wrap gap-2">
          {directions.map((d) => {
            const first = d.stops[0]?.name;
            const last = d.stops[d.stops.length - 1]?.name;
            const on = d.kind === active.kind;
            return (
              <button
                key={d.kind}
                type="button"
                aria-pressed={on}
                onClick={() => choose(d.kind)}
                className={cn(
                  "min-h-10 rounded-lg border px-3 py-1.5 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  on ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-accent",
                )}
              >
                <span className="block font-medium">{DIRECTION_LABEL[d.kind]}</span>
                {first && last && (
                  <span className={cn("block text-xs", on ? "text-primary-foreground/80" : "text-muted-foreground")}>
                    {first} to {last}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">One-way: no return direction is recorded for this route.</p>
      )}
      <StopList stops={active.stops} />
      {active.paths.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No route line has been recorded for this direction, so none is drawn on the map.
        </p>
      )}
    </div>
  );
}
