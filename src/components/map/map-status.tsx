import { Loader2, MapPinOff, TriangleAlert } from "lucide-react";

type MapStatusProps = {
  loading: boolean;
  error: string | null;
  /** Message to show when there is nothing to draw, or null. */
  empty: string | null;
  tilesFailed: boolean;
};

const CARD = "pointer-events-auto flex max-w-sm items-start gap-2 rounded-xl border bg-background p-3 text-sm shadow-md";

/** Loading, error and empty states layered over the base map. */
export function MapStatus({ loading, error, empty, tilesFailed }: MapStatusProps) {
  return (
    <>
      {(loading || error || empty) && (
        <div className="pointer-events-none absolute inset-0 z-[600] grid place-items-center p-4">
          {loading ? (
            <p role="status" className={CARD}>
              <Loader2 aria-hidden="true" className="mt-0.5 size-4 shrink-0 animate-spin" />
              Loading routes…
            </p>
          ) : error ? (
            <div role="alert" className={`${CARD} border-destructive/40 text-destructive`}>
              <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <p>{error}</p>
            </div>
          ) : (
            <p role="status" className={CARD}>
              <MapPinOff aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              {empty}
            </p>
          )}
        </div>
      )}
      {tilesFailed && (
        <p
          role="status"
          className="pointer-events-none absolute bottom-8 left-3 z-[600] max-w-[calc(100%-1.5rem)] rounded-lg border bg-background px-3 py-2 text-xs shadow-md"
        >
          The base map couldn&apos;t be loaded. Routes and stops are still shown.
        </p>
      )}
    </>
  );
}
