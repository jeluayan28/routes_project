"use client";

import { useId } from "react";
import { TransportFilter } from "@/components/search/transport-filter";
import type { Route } from "@/lib/validation/route";
import type { VehicleType } from "@/lib/validation/transport";

type MapToolbarProps = {
  types: readonly VehicleType[];
  onTypesChange: (types: VehicleType[]) => void;
  /** Routes that pass the current filters. */
  routes: readonly Route[];
  selectedId: string | null;
  /** Called with null when "All routes" is chosen. */
  onSelect: (route: Route | null) => void;
};

/** Transport-type toggles and a route picker, kept in step with the route list. */
export function MapToolbar({ types, onTypesChange, routes, selectedId, onSelect }: MapToolbarProps) {
  const selectId = useId();
  return (
    <div className="flex max-w-full flex-col gap-2 rounded-xl border bg-background/95 p-2 shadow-sm backdrop-blur">
      <TransportFilter value={types} onChange={onTypesChange} legend="Show transport types" />
      <div>
        <label htmlFor={selectId} className="sr-only">
          Select a route
        </label>
        <select
          id={selectId}
          value={selectedId ?? ""}
          onChange={(e) => onSelect(routes.find((r) => r.id === e.target.value) ?? null)}
          className="h-10 w-full rounded-lg border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-9"
        >
          <option value="">{routes.length === 0 ? "No routes to select" : "All routes"}</option>
          {routes.map((route) => (
            <option key={route.id} value={route.id}>
              {route.code} · {route.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
