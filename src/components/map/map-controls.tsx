"use client";

import { Crosshair, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type MapControlsProps = {
  /** Re-frames the map on the selected route, or on all routes. */
  onResetView: () => void;
  /** Shown only while a route is selected. */
  onClearSelection?: () => void;
};

/** Overlay buttons for the routes map. Zoom +/- come from Leaflet itself. */
export function MapControls({ onResetView, onClearSelection }: MapControlsProps) {
  return (
    <div className="absolute top-3 right-3 z-[500] flex flex-col gap-2">
      <Button type="button" variant="outline" size="sm" className="bg-background shadow-sm" onClick={onResetView}>
        <Crosshair aria-hidden="true" />
        Reset view
      </Button>
      {onClearSelection && (
        <Button type="button" variant="outline" size="sm" className="bg-background shadow-sm" onClick={onClearSelection}>
          <X aria-hidden="true" />
          Clear selection
        </Button>
      )}
    </div>
  );
}
