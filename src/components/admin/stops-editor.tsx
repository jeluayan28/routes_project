"use client";

import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { useEffect, useId, useState, useTransition } from "react";
import { EditorMapLazy } from "@/components/admin/editor-map-lazy";
import { Field, Notice, selectClass } from "@/components/admin/admin-ui";
import { NearbyStops } from "@/components/admin/nearby-stops";
import { VerificationBadge } from "@/components/common/verification-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createStopAction, searchStopsAction } from "@/lib/admin/actions/routes";
import type { EditorStop } from "@/lib/admin/data";
import { moveItem, parseCoordinatePair, type DirectionDraft } from "@/lib/admin/route-form";
import { routeColor } from "@/lib/routes/colors";
import { cn } from "@/lib/utils";
import type { Coordinate } from "@/lib/validation/transport";

type DraftStop = DirectionDraft["stops"][number];

/** Creates a stop; if one is already almost on the same spot, asks before creating another. */
async function createStopConfirming(input: Parameters<typeof createStopAction>[0] & object) {
  const res = await createStopAction(input);
  if (!res.ok && res.fieldErrors?.nearby) {
    if (!window.confirm(res.error)) return { ok: false, error: "No stop was created." } as const;
    return createStopAction({ ...input, confirmNearby: true });
  }
  return res;
}

type Props = {
  routeKey: string;
  direction: DirectionDraft;
  otherDirection: DirectionDraft | null;
  stops: Record<string, EditorStop>;
  onChange: (stops: DraftStop[]) => void;
  onStopKnown: (stop: EditorStop) => void;
};

type Mode = "search" | "map" | "coordinates";

const TRI = [
  { value: "follow", label: "Follow the stop" },
  { value: "no", label: "Not allowed here" },
  { value: "yes", label: "Allowed here" },
] as const;
const toTri = (v: boolean | null) => (v === null ? "follow" : v ? "yes" : "no");
const fromTri = (v: string) => (v === "follow" ? null : v === "yes");

export function StopsEditor({ routeKey, direction, otherDirection, stops, onChange, onStopKnown }: Props) {
  const uid = useId();
  const [mode, setMode] = useState<Mode>("search");
  const [message, setMessage] = useState<{ tone: "error" | "success" | "warning"; text: string } | null>(null);
  const [fitKey, setFitKey] = useState(0);
  const list = direction.stops;
  const onRoute = new Set(list.map((s) => s.stopId));

  const add = (stop: EditorStop) => {
    onStopKnown(stop);
    if (onRoute.has(stop.id)) return setMessage({ tone: "warning", text: `“${stop.name}” is already in this direction.` });
    onChange([...list, { stopId: stop.id, boarding: null, dropoff: null }]);
    setMessage({ tone: "success", text: `Added “${stop.name}” as stop ${list.length + 1}.` });
  };

  const update = (index: number, patch: Partial<DraftStop>) => onChange(list.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  const move = (index: number, to: number) => {
    onChange(moveItem(list, index, to));
    setMessage({ tone: "success", text: `Moved “${stops[list[index].stopId]?.name ?? "stop"}” to position ${to + 1}.` });
  };

  const mapStops = list.flatMap((s, i) => {
    const stop = stops[s.stopId];
    return stop ? [{ id: stop.id, name: stop.name, position: { lat: stop.latitude, lng: stop.longitude }, order: i + 1 }] : [];
  });

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section aria-labelledby={`${uid}-list`} className="space-y-3">
        <h3 id={`${uid}-list`} className="text-base font-semibold">
          {direction.kind === "outbound" ? "Outbound" : "Inbound"} stops, in order <span className="font-normal text-muted-foreground">({list.length})</span>
        </h3>
        <p className="text-sm text-muted-foreground">
          The first stop is where this direction starts and the last is where it ends. Each direction has its own list.
        </p>
        {message && <Notice tone={message.tone}>{message.text}</Notice>}

        {list.length === 0 ? (
          <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">No stops yet. Add one below.</p>
        ) : (
          <ol className="space-y-2">
            {list.map((s, i) => {
              const stop = stops[s.stopId];
              const name = stop?.name ?? "Unknown stop";
              return (
                <li key={s.stopId} className="rounded-lg border bg-card p-3">
                  <div className="flex items-start gap-2">
                    <span aria-hidden="true" className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-slate-800 text-xs font-semibold text-white">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        <span className="sr-only">Stop {i + 1}: </span>{name}
                      </p>
                      {stop && (
                        <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          {stop.latitude}, {stop.longitude}
                          <VerificationBadge status={stop.status} />
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button type="button" variant="outline" size="icon" disabled={i === 0} onClick={() => move(i, i - 1)} aria-label={`Move ${name} up`}>
                        <ArrowUp aria-hidden="true" />
                      </Button>
                      <Button type="button" variant="outline" size="icon" disabled={i === list.length - 1} onClick={() => move(i, i + 1)} aria-label={`Move ${name} down`}>
                        <ArrowDown aria-hidden="true" />
                      </Button>
                      <Button type="button" variant="outline" size="icon" onClick={() => onChange(list.filter((_, j) => j !== i))} aria-label={`Remove ${name}`}>
                        <Trash2 aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <Field id={`${uid}-b${i}`} label="Boarding">
                      <select id={`${uid}-b${i}`} className={selectClass} value={toTri(s.boarding)} onChange={(e) => update(i, { boarding: fromTri(e.target.value) })}>
                        {TRI.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </Field>
                    <Field id={`${uid}-d${i}`} label="Drop-off">
                      <select id={`${uid}-d${i}`} className={selectClass} value={toTri(s.dropoff)} onChange={(e) => update(i, { dropoff: fromTri(e.target.value) })}>
                        {TRI.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </Field>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <section aria-labelledby={`${uid}-add`} className="space-y-3">
        <h3 id={`${uid}-add`} className="text-base font-semibold">Add a stop</h3>
        <div role="group" aria-label="How to add a stop" className="flex flex-wrap gap-2">
          {([["search", "Search existing stops"], ["map", "Pick on the map"], ["coordinates", "Enter coordinates"]] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={mode === key}
              onClick={() => setMode(key)}
              className={cn(
                "min-h-9 rounded-full border px-3.5 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring",
                mode === key ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-accent",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === "search" && <SearchPanel onRoute={onRoute} onAdd={add} />}
        {mode === "coordinates" && <CoordinatesPanel onCreated={add} />}
        {mode === "map" && (
          <MapPanel
            routeKey={routeKey}
            direction={direction}
            otherDirection={otherDirection}
            mapStops={mapStops}
            fitKey={fitKey}
            onFit={() => setFitKey((k) => k + 1)}
            onCreated={add}
          />
        )}
      </section>
    </div>
  );
}

function SearchPanel({ onRoute, onAdd }: { onRoute: Set<string>; onAdd: (s: EditorStop) => void }) {
  const uid = useId();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<EditorStop[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const term = query.trim();
    if (term === "") return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setState("loading");
      const res = await searchStopsAction(term);
      if (cancelled) return;
      if (res.ok) {
        setResults(res.data);
        setState("idle");
        setError(null);
      } else {
        setState("error");
        setError(res.error);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const shown = query.trim() === "" ? [] : results;
  return (
    <div className="space-y-3">
      <Field id={`${uid}-q`} label="Search by stop name" hint="Reuse a stop that already exists instead of creating a duplicate.">
        <Input id={`${uid}-q`} type="search" value={query} onChange={(e) => setQuery(e.target.value)} maxLength={100} autoComplete="off" />
      </Field>
      {error && <Notice tone="error">{error}</Notice>}
      <p aria-live="polite" className="text-xs text-muted-foreground">
        {state === "loading" ? "Searching…" : query.trim() === "" ? "" : `${shown.length} ${shown.length === 1 ? "match" : "matches"}`}
      </p>
      <ul className="space-y-2">
        {shown.map((stop) => (
          <li key={stop.id} className="flex items-center justify-between gap-2 rounded-lg border bg-card p-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{stop.name}</p>
              <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {stop.latitude}, {stop.longitude}{stop.barangay ? ` · ${stop.barangay}` : ""}
                <VerificationBadge status={stop.status} />
              </p>
            </div>
            <Button type="button" size="sm" variant="outline" disabled={onRoute.has(stop.id)} onClick={() => onAdd(stop)}>
              {onRoute.has(stop.id) ? "Added" : "Add"}
              <span className="sr-only"> {stop.name}</span>
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function NewStopFields({ uid, name, barangay, setName, setBarangay }: { uid: string; name: string; barangay: string; setName: (v: string) => void; setBarangay: (v: string) => void }) {
  return (
    <>
      <Field id={`${uid}-name`} label="Stop name">
        <Input id={`${uid}-name`} value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field id={`${uid}-brgy`} label="Barangay (optional)">
        <Input id={`${uid}-brgy`} value={barangay} maxLength={100} onChange={(e) => setBarangay(e.target.value)} />
      </Field>
    </>
  );
}

function CoordinatesPanel({ onCreated }: { onCreated: (s: EditorStop) => void }) {
  const uid = useId();
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [name, setName] = useState("");
  const [barangay, setBarangay] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [pending, startTransition] = useTransition();
  const pair = parseCoordinatePair(lat, lng);
  const showErrors = touched && !pair.ok;

  const submit = () =>
    startTransition(async () => {
      setTouched(true);
      setError(null);
      if (!pair.ok || name.trim() === "") return;
      const res = await createStopConfirming({ name, latitude: pair.coordinate.lat, longitude: pair.coordinate.lng, barangay, landmark: "", pickup: true, dropoff: true });
      if (!res.ok) return setError(res.error);
      onCreated(res.data);
      setName("");
      setLat("");
      setLng("");
      setTouched(false);
    });

  return (
    <form
      className="space-y-3"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <p className="text-sm text-muted-foreground">Decimal degrees, e.g. copied from a map app. Latitude first, then longitude.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id={`${uid}-lat`} label="Latitude" error={showErrors && !pair.ok ? pair.errors.latitude ?? pair.errors.both : null}>
          <Input id={`${uid}-lat`} inputMode="decimal" value={lat} aria-invalid={showErrors && !pair.ok && Boolean(pair.errors.latitude)} onChange={(e) => setLat(e.target.value)} />
        </Field>
        <Field id={`${uid}-lng`} label="Longitude" error={showErrors && !pair.ok ? pair.errors.longitude : null}>
          <Input id={`${uid}-lng`} inputMode="decimal" value={lng} aria-invalid={showErrors && !pair.ok && Boolean(pair.errors.longitude)} onChange={(e) => setLng(e.target.value)} />
        </Field>
      </div>
      {pair.ok && pair.warning && <Notice tone="warning">{pair.warning}</Notice>}
      <NearbyStops point={pair.ok ? pair.coordinate : null} />
      <NewStopFields uid={uid} name={name} barangay={barangay} setName={setName} setBarangay={setBarangay} />
      {error && <Notice tone="error">{error}</Notice>}
      <Button type="submit" disabled={pending}>{pending ? "Creating…" : "Create stop and add it"}</Button>
    </form>
  );
}

function MapPanel({
  routeKey, direction, otherDirection, mapStops, fitKey, onFit, onCreated,
}: {
  routeKey: string;
  direction: DirectionDraft;
  otherDirection: DirectionDraft | null;
  mapStops: { id: string; name: string; position: Coordinate; order: number }[];
  fitKey: number;
  onFit: () => void;
  onCreated: (s: EditorStop) => void;
}) {
  const uid = useId();
  const [point, setPoint] = useState<Coordinate | null>(null);
  const [name, setName] = useState("");
  const [barangay, setBarangay] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () =>
    startTransition(async () => {
      setError(null);
      if (!point) return setError("Click the map to choose the stop's location first.");
      const res = await createStopConfirming({ name, latitude: point.lat, longitude: point.lng, barangay, landmark: "", pickup: true, dropoff: true });
      if (!res.ok) return setError(res.error);
      onCreated(res.data);
      setPoint(null);
      setName("");
    });

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Click the map where passengers actually board or get off. Zoom in first for accuracy. The map shows this direction&apos;s stops in order.
      </p>
      <div className="h-80 overflow-hidden rounded-lg border">
        <EditorMapLazy
          stops={mapStops}
          lines={direction.lines}
          otherLines={otherDirection?.lines}
          color={routeColor(routeKey)}
          picking
          pending={point}
          onPick={setPoint}
          fitKey={fitKey}
          label="Map for choosing a stop location"
          className="h-full w-full"
        />
      </div>
      <Button type="button" variant="outline" size="sm" onClick={onFit}>Fit map to this route</Button>
      <NearbyStops point={point} />
      <p aria-live="polite" className="text-sm">
        {point ? <>Chosen location: <strong>{point.lat}, {point.lng}</strong></> : "No location chosen yet."}
      </p>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <NewStopFields uid={uid} name={name} barangay={barangay} setName={setName} setBarangay={setBarangay} />
        {error && <Notice tone="error">{error}</Notice>}
        <Button type="submit" disabled={pending || !point || name.trim() === ""}>{pending ? "Creating…" : "Create stop here and add it"}</Button>
      </form>
    </div>
  );
}
