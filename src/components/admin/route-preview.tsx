"use client";

import { Notice } from "@/components/admin/admin-ui";
import { RouteMapLazy } from "@/components/map/route-map-lazy";
import { RouteDetailsPanel } from "@/components/routes/route-details-panel";
import { publicStatus } from "@/lib/admin/dashboard";
import { draftToRoute, type RouteDraft } from "@/lib/admin/route-form";
import type { EditorStop, RouteRow } from "@/lib/admin/data";

/**
 * What visitors would see for this route, built from the editor's current
 * (possibly unsaved) draft, plus whether and why it is public right now.
 */
export function RoutePreview({
  routeId,
  draft,
  stops,
  route,
  dirty,
}: {
  routeId: string | null;
  draft: RouteDraft;
  stops: Record<string, EditorStop>;
  route: RouteRow | null;
  dirty: boolean;
}) {
  const model = draftToRoute(draft, stops, { id: routeId ?? "preview", status: route?.verification_status ?? "unverified" });
  const visibility = route ? publicStatus(route) : { public: false, reason: "Not public: this route has not been saved yet." };
  const hasStops = model.directions.some((d) => d.stops.length > 0);

  return (
    <div className="space-y-4">
      <Notice tone={visibility.public ? "success" : "info"}>{visibility.reason}</Notice>
      {dirty && <Notice tone="warning">This preview shows your unsaved changes. Visitors see only what has been saved, verified and made active.</Notice>}
      {!hasStops ? (
        <Notice tone="warning">Add stops to this route to preview it.</Notice>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,26rem)_1fr]">
          <div className="rounded-2xl border bg-card p-5 shadow-xs">
            <RouteDetailsPanel route={model} headingLevel="h2" />
          </div>
          <div className="isolate h-96 overflow-hidden rounded-2xl border shadow-xs">
            <RouteMapLazy routes={[model]} selectedId={model.id} label={`Preview map of ${model.name}`} className="h-full w-full" />
          </div>
        </div>
      )}
    </div>
  );
}
