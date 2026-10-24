"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState, useTransition } from "react";
import { FaresEditor } from "@/components/admin/fares-editor";
import { GeometryEditor } from "@/components/admin/geometry-editor";
import { Field, Notice, RouteBadges, selectClass, textareaClass } from "@/components/admin/admin-ui";
import { RoutePreview } from "@/components/admin/route-preview";
import { StopsEditor } from "@/components/admin/stops-editor";
import { VerificationPanel } from "@/components/admin/verification-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveRouteAction } from "@/lib/admin/actions/routes";
import type { EditorData, EditorStop, FareRow } from "@/lib/admin/data";
import { draftWarnings, routeDraftSchema, type DirectionDraft, type RouteDraft } from "@/lib/admin/route-form";
import { VEHICLE_LABEL } from "@/lib/format";
import { cn } from "@/lib/utils";
import { vehicleTypeSchema } from "@/lib/validation/transport";
import type { DirectionKind } from "@/lib/validation/route";

export type EditorTab = "details" | "stops" | "geometry" | "fares" | "preview" | "verify";

const TABS: { key: EditorTab; label: string; needsSaved?: boolean }[] = [
  { key: "details", label: "Details" },
  { key: "stops", label: "Directions & stops" },
  { key: "geometry", label: "Geometry" },
  { key: "fares", label: "Fares", needsSaved: true },
  { key: "preview", label: "Preview" },
  { key: "verify", label: "Verification & status", needsSaved: true },
];

const BLANK: RouteDraft = {
  code: "", name: "", transportType: "minibus", description: "", originLabel: "", destinationLabel: "",
  directions: [{ kind: "outbound", stops: [], lines: [], geometrySource: "" }],
};

export function RouteEditor({ data, initialTab = "details" }: { data: EditorData | null; initialTab?: EditorTab }) {
  const uid = useId();
  const router = useRouter();
  const routeId = data?.routeId ?? null;
  const [draft, setDraft] = useState<RouteDraft>(data?.draft ?? BLANK);
  const [saved, setSaved] = useState(() => JSON.stringify(data?.draft ?? BLANK));
  const [stops, setStops] = useState<Record<string, EditorStop>>(data?.stops ?? {});
  const [fares, setFares] = useState<FareRow[]>(data?.fares ?? []);
  const [tab, setTab] = useState<EditorTab>(routeId || initialTab === "details" ? initialTab : "details");
  const [dirKind, setDirKind] = useState<DirectionKind>("outbound");
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty = JSON.stringify(draft) !== saved;

  // Don't lose work by closing the tab or following an external link.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const active = draft.directions.find((d) => d.kind === dirKind) ?? draft.directions[0];
  const other = draft.directions.find((d) => d.kind !== active.kind) ?? null;
  const set = <K extends keyof RouteDraft>(key: K, value: RouteDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const patchDirection = (kind: DirectionKind, patch: Partial<DirectionDraft>) =>
    setDraft((d) => ({ ...d, directions: d.directions.map((x) => (x.kind === kind ? { ...x, ...patch } : x)) }));

  const addInbound = () => {
    setDraft((d) => ({ ...d, directions: [...d.directions, { kind: "inbound", stops: [], lines: [], geometrySource: "" }] }));
    setDirKind("inbound");
  };
  const removeInbound = () => {
    if (!window.confirm("Make this route one-way? The inbound stops and geometry will be removed when you save.")) return;
    setDraft((d) => ({ ...d, directions: d.directions.filter((x) => x.kind !== "inbound") }));
    setDirKind("outbound");
  };

  const save = () =>
    startTransition(async () => {
      setMessage(null);
      const parsed = routeDraftSchema.safeParse(draft);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        if (issue?.path[0] === "name") setNameError(issue.message);
        setMessage({ tone: "error", text: issue?.message ?? "Some values are not valid." });
        if (issue?.path[0] === "name") setTab("details");
        return;
      }
      setNameError(null);
      const res = await saveRouteAction(routeId, draft);
      if (!res.ok) return setMessage({ tone: "error", text: res.error });
      setSaved(JSON.stringify(draft));
      setMessage({ tone: "success", text: routeId ? "Saved. If this route was verified and you changed it, it is now unverified." : "Draft created." });
      if (!routeId) router.push(`/admin/routes/${res.data.id}`);
      else router.refresh();
    });

  const parsedDraft = routeDraftSchema.safeParse(draft);
  const warnings = parsedDraft.success ? draftWarnings(parsedDraft.data) : [];

  // Fares may only use stops that are on the saved route.
  const savedStopIds = (() => {
    try {
      const d = JSON.parse(saved) as RouteDraft;
      return [...new Set(d.directions.flatMap((x) => x.stops.map((s) => s.stopId)))];
    } catch {
      return [];
    }
  })();
  const fareStops = savedStopIds.flatMap((id) => (stops[id] ? [stops[id]] : []));

  return (
    <div className="space-y-5">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{routeId ? draft.name || "Untitled route" : "New draft route"}</h1>
        {data ? (
          <RouteBadges route={data.route} />
        ) : (
          <Notice tone="info">New routes are saved as drafts. A draft is never public and is not treated as a confirmed service.</Notice>
        )}
        {data?.batch && (
          <p className="text-sm text-muted-foreground">Imported from “{data.batch.source_description}”. Check it against its source before verifying.</p>
        )}
      </header>

      <div role="tablist" aria-label="Route sections" className="flex flex-wrap gap-1 border-b">
        {TABS.map((t) => {
          const disabled = Boolean(t.needsSaved && !routeId);
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              id={`${uid}-tab-${t.key}`}
              aria-selected={tab === t.key}
              aria-controls={`${uid}-panel`}
              disabled={disabled}
              title={disabled ? "Save the route first" : undefined}
              onClick={() => setTab(t.key)}
              className={cn(
                "-mb-px min-h-10 border-b-2 px-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40",
                tab === t.key ? "border-primary text-link" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {(tab === "stops" || tab === "geometry") && (
        <div role="group" aria-label="Direction" className="flex flex-wrap items-center gap-2">
          {draft.directions.map((d) => (
            <button
              key={d.kind}
              type="button"
              aria-pressed={active.kind === d.kind}
              onClick={() => setDirKind(d.kind)}
              className={cn(
                "min-h-9 rounded-full border px-3.5 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active.kind === d.kind ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-accent",
              )}
            >
              {d.kind === "outbound" ? "Outbound" : "Inbound"}
            </button>
          ))}
          {draft.directions.length === 1 ? (
            <Button type="button" variant="outline" size="sm" onClick={addInbound}>Add an inbound direction</Button>
          ) : (
            <Button type="button" variant="outline" size="sm" onClick={removeInbound}>Make the route one-way</Button>
          )}
          {draft.directions.length === 1 && <span className="text-sm text-muted-foreground">This route is one-way: no return trip is recorded.</span>}
        </div>
      )}

      <div role="tabpanel" id={`${uid}-panel`} aria-labelledby={`${uid}-tab-${tab}`} className="min-h-[12rem]">
        {tab === "details" && (
          <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
            <Field id={`${uid}-name`} label="Route name" error={nameError} className="sm:col-span-2">
              <Input id={`${uid}-name`} value={draft.name} maxLength={200} aria-invalid={Boolean(nameError)} onChange={(e) => set("name", e.target.value)} />
            </Field>
            <Field id={`${uid}-code`} label="Route code (optional)" hint="A public identifier such as an LGU or franchise code, if one exists.">
              <Input id={`${uid}-code`} value={draft.code} maxLength={50} onChange={(e) => set("code", e.target.value)} />
            </Field>
            <Field id={`${uid}-type`} label="Transport type">
              <select id={`${uid}-type`} className={selectClass} value={draft.transportType} onChange={(e) => set("transportType", e.target.value as RouteDraft["transportType"])}>
                {vehicleTypeSchema.options.map((t) => <option key={t} value={t}>{VEHICLE_LABEL[t]}</option>)}
              </select>
            </Field>
            <Field id={`${uid}-origin`} label="Starting point" hint="Where the outbound direction starts.">
              <Input id={`${uid}-origin`} value={draft.originLabel} maxLength={120} onChange={(e) => set("originLabel", e.target.value)} />
            </Field>
            <Field id={`${uid}-dest`} label="Ending point" hint="Where the outbound direction ends.">
              <Input id={`${uid}-dest`} value={draft.destinationLabel} maxLength={120} onChange={(e) => set("destinationLabel", e.target.value)} />
            </Field>
            <Field id={`${uid}-desc`} label="Description (optional)" className="sm:col-span-2">
              <textarea id={`${uid}-desc`} rows={3} maxLength={1000} value={draft.description} onChange={(e) => set("description", e.target.value)} className={textareaClass} />
            </Field>
          </div>
        )}

        {tab === "stops" && (
          <StopsEditor
            key={active.kind}
            routeKey={routeId ?? "new"}
            direction={active}
            otherDirection={other}
            stops={stops}
            onChange={(list) => patchDirection(active.kind, { stops: list })}
            onStopKnown={(s) => setStops((prev) => ({ ...prev, [s.id]: s }))}
          />
        )}

        {tab === "geometry" && (
          <GeometryEditor
            key={active.kind}
            routeKey={routeId ?? "new"}
            direction={active}
            otherDirection={other}
            stops={stops}
            onChange={(patch) => patchDirection(active.kind, patch)}
          />
        )}

        {tab === "fares" && routeId && (
          <FaresEditor routeId={routeId} fares={fares} stops={fareStops} dirty={dirty} onChange={setFares} />
        )}

        {tab === "preview" && <RoutePreview routeId={routeId} draft={draft} stops={stops} route={data?.route ?? null} dirty={dirty} />}

        {tab === "verify" && data && (
          <VerificationPanel
            route={data.route}
            verifications={data.verifications}
            dirty={dirty}
            onChanged={() => router.refresh()}
            onDeleted={() => router.push("/admin/routes")}
          />
        )}
      </div>

      {(tab === "details" || tab === "stops" || tab === "geometry") && warnings.length > 0 && (
        <Notice tone="warning">
          <p className="font-medium">Before this route can be verified:</p>
          <ul className="list-disc pl-5">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </Notice>
      )}

      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-3 border-t bg-background/95 px-4 py-3 backdrop-blur">
        <Button type="button" onClick={save} disabled={pending || (!dirty && Boolean(routeId))}>
          {pending ? "Saving…" : routeId ? "Save changes" : "Create draft route"}
        </Button>
        <span aria-live="polite" className="text-sm text-muted-foreground">
          {dirty ? "You have unsaved changes." : routeId ? "All changes saved." : ""}
        </span>
        {message && <Notice tone={message.tone} className="py-1">{message.text}</Notice>}
      </div>
    </div>
  );
}
