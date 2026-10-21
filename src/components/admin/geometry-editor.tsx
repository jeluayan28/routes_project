"use client";

import { useId, useState } from "react";
import { EditorMapLazy } from "@/components/admin/editor-map-lazy";
import { Field, Notice, textareaClass } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { EditorStop } from "@/lib/admin/data";
import { linesToText, parseGeometryText, type DirectionDraft } from "@/lib/admin/route-form";
import { routeColor } from "@/lib/routes/colors";
import type { Coordinate } from "@/lib/validation/transport";

type Props = {
  routeKey: string;
  direction: DirectionDraft;
  otherDirection: DirectionDraft | null;
  stops: Record<string, EditorStop>;
  onChange: (patch: Partial<Pick<DirectionDraft, "lines" | "geometrySource">>) => void;
};

/**
 * Geometry is recorded, never generated: paste it, type it, or click points
 * along the real road. Connecting the stops with straight lines is deliberately
 * not offered.
 */
export function GeometryEditor({ routeKey, direction, otherDirection, stops, onChange }: Props) {
  const uid = useId();
  const [text, setText] = useState(() => linesToText(direction.lines));
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [clicking, setClicking] = useState(false);
  const [fitKey, setFitKey] = useState(0);
  // Points clicked on the map that have not been committed as a line yet.
  const [drawing, setDrawing] = useState<Coordinate[]>([]);

  const lines = direction.lines;
  const points = lines.reduce((n, l) => n + l.length, 0);

  const setLines = (next: Coordinate[][]) => {
    onChange({ lines: next });
    setText(linesToText(next));
    setErrors([]);
    setWarnings([]);
  };

  const apply = () => {
    const result = parseGeometryText(text);
    if (!result.ok) {
      setErrors(result.errors);
      setWarnings([]);
      return;
    }
    onChange({ lines: result.lines });
    setText(linesToText(result.lines));
    setErrors([]);
    setWarnings(result.warnings);
    setFitKey((k) => k + 1);
  };

  const finishLine = () => {
    setLines([...lines, drawing]);
    setDrawing([]);
  };

  const undo = () => {
    if (drawing.length > 0) return setDrawing(drawing.slice(0, -1));
    const next = lines.map((l) => [...l]);
    if (next.length === 0) return;
    next[next.length - 1].pop();
    setLines(next[next.length - 1].length < 2 ? next.slice(0, -1) : next);
  };

  const mapStops = direction.stops.flatMap((s, i) => {
    const st = stops[s.stopId];
    return st ? [{ id: st.id, name: st.name, position: { lat: st.latitude, lng: st.longitude }, order: i + 1 }] : [];
  });

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section aria-labelledby={`${uid}-h`} className="space-y-3">
        <h3 id={`${uid}-h`} className="text-base font-semibold">
          {direction.kind === "outbound" ? "Outbound" : "Inbound"} geometry
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            {lines.length === 0 ? "none recorded" : `${lines.length} ${lines.length === 1 ? "line" : "lines"}, ${points} points`}
          </span>
        </h3>
        <Notice tone="info">
          Record the path vehicles really take, following the roads. Do not join the stops with straight lines: if no real path is
          known, leave the geometry empty and no line will be shown.
        </Notice>

        <Field
          id={`${uid}-text`}
          label="Points, one “latitude, longitude” per line"
          hint="Leave a blank line between separate lines. You can also paste GeoJSON (LineString or MultiLineString, longitude first)."
        >
          <textarea
            id={`${uid}-text`}
            rows={10}
            spellCheck={false}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className={`${textareaClass} font-mono`}
            aria-describedby={errors.length ? `${uid}-errors` : undefined}
          />
        </Field>
        {errors.length > 0 && (
          <div id={`${uid}-errors`} role="alert" className="rounded-lg border border-destructive/40 bg-red-50 px-3 py-2 text-sm text-red-900">
            <p className="font-medium">Fix these before applying:</p>
            <ul className="list-disc pl-5">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
          </div>
        )}
        {warnings.map((w) => <Notice key={w} tone="warning">{w}</Notice>)}
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={apply}>Apply text to route</Button>
          <Button type="button" variant="outline" onClick={() => setText(linesToText(lines))}>Reset text</Button>
          <Button type="button" variant="outline" disabled={lines.length === 0} onClick={() => setLines([])}>Clear geometry</Button>
        </div>

        <Field id={`${uid}-src`} label="Where did this geometry come from?" hint="For example a field trace or a document and its date. Required before verification.">
          <Input id={`${uid}-src`} value={direction.geometrySource} maxLength={300} onChange={(e) => onChange({ geometrySource: e.target.value })} />
        </Field>
      </section>

      <section aria-labelledby={`${uid}-map`} className="space-y-3">
        <h3 id={`${uid}-map`} className="text-base font-semibold">Map</h3>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant={clicking ? "default" : "outline"} aria-pressed={clicking} onClick={() => setClicking((v) => !v)}>
            {clicking ? "Drawing: click along the road" : "Draw a line by clicking the map"}
          </Button>
          <Button type="button" disabled={drawing.length < 2} onClick={finishLine}>
            Finish line ({drawing.length} {drawing.length === 1 ? "point" : "points"})
          </Button>
          <Button type="button" variant="outline" disabled={points === 0 && drawing.length === 0} onClick={undo}>Undo last point</Button>
          <Button type="button" variant="outline" disabled={drawing.length === 0} onClick={() => setDrawing([])}>Discard drawing</Button>
          <Button type="button" variant="outline" onClick={() => setFitKey((k) => k + 1)}>Fit map</Button>
        </div>
        <div className="h-96 overflow-hidden rounded-lg border">
          <EditorMapLazy
            stops={mapStops}
            lines={lines}
            otherLines={otherDirection?.lines}
            color={routeColor(routeKey)}
            picking={clicking}
            pending={null}
            drawing={drawing}
            onPick={(p) => setDrawing((d) => [...d, p])}
            fitKey={fitKey}
            label="Map showing the recorded geometry"
            className="h-full w-full"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Numbered markers are this direction&apos;s stops. The dashed line, if any, is the other direction. Click along the road to draw a new line, then choose Finish line. Typed changes in the text box take effect when you choose Apply.
        </p>
      </section>
    </div>
  );
}
