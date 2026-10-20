"use client";

import Link from "next/link";
import { useId, useMemo, useState } from "react";
import { ChevronUp, MapPinOff, Search, SearchX, Info, ArrowLeft } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { SampleDataBanner } from "@/components/common/sample-data-banner";
import { RoutesMapLazy } from "@/components/map/routes-map-lazy";
import { RouteDetailsPanel } from "@/components/routes/route-details-panel";
import { RouteList } from "@/components/routes/route-list";
import { TransportFilter } from "@/components/search/transport-filter";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { DataSource } from "@/lib/data/routes";
import { filterRoutes } from "@/lib/routes/filter";
import { cn } from "@/lib/utils";
import type { Route } from "@/lib/validation/route";
import type { VehicleType } from "@/lib/validation/transport";

export type ExploreViewProps = {
  routes: Route[];
  source: DataSource;
  initialQuery?: string;
  initialTypes?: VehicleType[];
  initialSelectedId?: string | null;
  /** Origin/destination carried over from the home page search, if any. */
  trip?: { from: string; to: string } | null;
};

export function ExploreView({
  routes,
  source,
  initialQuery = "",
  initialTypes = ["jeepney", "multicab"],
  initialSelectedId = null,
  trip = null,
}: ExploreViewProps) {
  const uid = useId();
  const [query, setQuery] = useState(initialQuery);
  const [types, setTypes] = useState<VehicleType[]>(initialTypes);
  const [selectedId, setSelectedId] = useState<string | null>(
    routes.some((r) => r.id === initialSelectedId) ? initialSelectedId : null,
  );
  // Mobile bottom sheet; ignored on large screens where the list is a sidebar.
  const [expanded, setExpanded] = useState(true);

  const visible = useMemo(() => filterRoutes(routes, { query, types }), [routes, query, types]);
  const selected = routes.find((r) => r.id === selectedId) ?? null;
  const mapRoutes = selected && !visible.some((r) => r.id === selected.id) ? [...visible, selected] : visible;
  const panelId = `${uid}-panel`;

  const clearFilters = () => {
    setQuery("");
    setTypes(["jeepney", "multicab"]);
  };

  const select = (route: Route) => {
    setSelectedId(route.id);
    setExpanded(true);
  };

  return (
    <div className="relative flex h-[calc(100svh-3.5rem)] min-h-[34rem] flex-col lg:flex-row">
      <div className="absolute inset-0 isolate lg:static lg:flex-1">
        <RoutesMapLazy
          routes={mapRoutes}
          selectedId={selectedId}
          onSelect={select}
          onClearSelection={() => setSelectedId(null)}
          label={
            selected
              ? `Map showing route ${selected.code}`
              : `Map of Butuan City showing ${visible.length} ${visible.length === 1 ? "route" : "routes"}`
          }
          className="h-full w-full"
        />
      </div>

      <aside
        aria-label="Routes"
        className="absolute inset-x-0 bottom-0 z-10 flex max-h-[68%] flex-col rounded-t-2xl border-t bg-background shadow-[0_-4px_16px_rgba(15,27,61,0.12)] lg:static lg:order-first lg:max-h-none lg:w-[26rem] lg:shrink-0 lg:rounded-none lg:border-t-0 lg:border-r lg:shadow-none"
      >
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center justify-between gap-2 rounded-t-2xl px-4 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
        >
          <span className="font-semibold">
            {selected ? selected.name : "Routes"}{" "}
            {!selected && <span className="font-normal text-muted-foreground">({visible.length})</span>}
          </span>
          <ChevronUp aria-hidden="true" className={cn("size-5 transition-transform", expanded && "rotate-180")} />
          <span className="sr-only">{expanded ? "Collapse route list" : "Expand route list"}</span>
        </button>

        <div
          id={panelId}
          className={cn("min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-4 lg:pt-4", !expanded && "max-lg:hidden")}
        >
          <SampleDataBanner source={source} />

          {trip && (
            <div role="note" className="flex items-start gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
              <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
              <p>
                You searched <strong className="text-green-700">{trip.from}</strong> to{" "}
                <strong className="text-red-700">{trip.to}</strong>. Trip planning isn&apos;t available
                yet, so you can browse and compare routes below.
              </p>
            </div>
          )}

          {selected ? (
            <div className="space-y-4">
              <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedId(null)}>
                <ArrowLeft aria-hidden="true" />
                Clear selection
              </Button>
              <RouteDetailsPanel route={selected} variant="summary" />
            </div>
          ) : (
            <>
              <div className="space-y-3">
                <div className="relative">
                  <Search
                    aria-hidden="true"
                    className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                  />
                  <Input
                    type="search"
                    aria-label="Search routes by name, code, or stop"
                    placeholder="Search by name, code, or stop"
                    value={query}
                    maxLength={100}
                    onChange={(e) => setQuery(e.target.value)}
                    className="h-10 bg-card pl-9"
                  />
                </div>
                <TransportFilter value={types} onChange={setTypes} />
              </div>

              <p aria-live="polite" className="text-sm text-muted-foreground">
                {visible.length} {visible.length === 1 ? "route" : "routes"}
              </p>

              {routes.length === 0 ? (
                <EmptyState
                  icon={MapPinOff}
                  title="No routes published yet"
                  description="Routes will appear here once verified local transport data has been added."
                />
              ) : types.length === 0 ? (
                <EmptyState
                  icon={SearchX}
                  title="No transport type selected"
                  description="Choose Jeepney, Multicab, or both to see routes."
                  action={
                    <Button type="button" variant="outline" onClick={clearFilters}>
                      Show all types
                    </Button>
                  }
                />
              ) : visible.length === 0 ? (
                <EmptyState
                  icon={SearchX}
                  title="No routes match"
                  description="Try a different search or include both transport types."
                  action={
                    <Button type="button" variant="outline" onClick={clearFilters}>
                      Clear filters
                    </Button>
                  }
                />
              ) : (
                <RouteList routes={visible} selectedId={selectedId} onSelect={select} label="Routes" />
              )}

              <Link href="/fares" className={cn(buttonVariants({ variant: "link" }), "px-0")}>
                See the fare guide
              </Link>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
