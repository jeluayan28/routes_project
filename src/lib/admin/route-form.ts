import { z } from "zod";
import { isInsideServiceArea } from "@/lib/constants";
import { parseCoordinate } from "@/lib/import/validate";
import { parseLineGeometry } from "@/lib/routes/geometry";
import { coordinateSchema, vehicleTypeSchema, type Coordinate } from "@/lib/validation/transport";
import { directionKindSchema } from "@/lib/validation/route";

// ---------------------------------------------------------------------------
// Draft shape edited by the route editor and sent to the save action
// ---------------------------------------------------------------------------

const MAX_POINTS = 10_000;

export const draftStopSchema = z.object({
  stopId: z.uuid(),
  /** null follows the stop's own setting; false restricts this route only. */
  boarding: z.boolean().nullable(),
  dropoff: z.boolean().nullable(),
});

export const draftDirectionSchema = z.object({
  kind: directionKindSchema,
  stops: z.array(draftStopSchema).max(200),
  /** One or more recorded lines. Empty means no geometry is recorded. */
  lines: z.array(z.array(coordinateSchema).min(2, "A line needs at least two points.").max(MAX_POINTS)).max(50),
  geometrySource: z.string().trim().max(300),
});

export const routeDraftSchema = z
  .object({
    code: z.string().trim().max(50),
    name: z.string().trim().min(1, "Give the route a name.").max(200),
    transportType: vehicleTypeSchema,
    description: z.string().trim().max(1000),
    originLabel: z.string().trim().max(120),
    destinationLabel: z.string().trim().max(120),
    directions: z.array(draftDirectionSchema).min(1).max(2),
  })
  .superRefine((draft, ctx) => {
    const kinds = draft.directions.map((d) => d.kind);
    if (new Set(kinds).size !== kinds.length) ctx.addIssue({ code: "custom", message: "A direction can only be listed once." });
    if (!kinds.includes("outbound")) ctx.addIssue({ code: "custom", message: "A route needs an outbound direction." });
    draft.directions.forEach((d, i) => {
      const ids = d.stops.map((s) => s.stopId.toLowerCase());
      if (new Set(ids).size !== ids.length) {
        ctx.addIssue({ code: "custom", path: ["directions", i, "stops"], message: `A stop can appear only once in the ${d.kind} direction.` });
      }
    });
  });

export type RouteDraft = z.infer<typeof routeDraftSchema>;
export type DirectionDraft = RouteDraft["directions"][number];

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** GeoJSON for one direction, with coordinates rounded to ~0.1 m. Null if none. */
export function linesToGeoJSON(lines: readonly (readonly Coordinate[])[]) {
  if (lines.length === 0) return null;
  const coords = lines.map((l) => l.map((c) => [round6(c.lng), round6(c.lat)]));
  return coords.length === 1 ? { type: "LineString", coordinates: coords[0] } : { type: "MultiLineString", coordinates: coords };
}

/** The `p_data` argument of public.save_route(). */
export function toSaveRoutePayload(draft: RouteDraft) {
  return {
    code: draft.code,
    name: draft.name,
    transport_type: draft.transportType,
    description: draft.description,
    origin_label: draft.originLabel,
    destination_label: draft.destinationLabel,
    directions: draft.directions.map((d) => ({
      direction: d.kind,
      stops: d.stops.map((s) => ({ stop_id: s.stopId, boarding_allowed: s.boarding, dropoff_allowed: s.dropoff })),
      geometry: linesToGeoJSON(d.lines),
      geometry_source: d.geometrySource,
    })),
  };
}

/** Non-blocking advice shown next to the editor. */
export function draftWarnings(draft: RouteDraft): string[] {
  const out: string[] = [];
  for (const d of draft.directions) {
    if (d.stops.length < 2) out.push(`The ${d.kind} direction has fewer than two stops.`);
    if (d.lines.length === 0) out.push(`No geometry is recorded for the ${d.kind} direction, so no line will be drawn.`);
    if (d.lines.length > 0 && !d.geometrySource) out.push(`Say where the ${d.kind} geometry came from (source).`);
    if (d.lines.some((l) => l.some((p) => !isInsideServiceArea(p)))) {
      out.push(`Some ${d.kind} geometry points are outside the Butuan City area. Check for swapped or mistyped values.`);
    }
  }
  if (!draft.originLabel || !draft.destinationLabel) out.push("Record the starting and ending points; they are needed before verification.");
  return out;
}

// ---------------------------------------------------------------------------
// Reordering
// ---------------------------------------------------------------------------

/** Returns a copy with the item at `from` moved to `to` (clamped). */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= items.length) return [...items];
  const target = Math.max(0, Math.min(items.length - 1, to));
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(target, 0, item);
  return next;
}

// ---------------------------------------------------------------------------
// Coordinates and geometry entered by hand
// ---------------------------------------------------------------------------

export type CoordinateResult =
  | { ok: true; coordinate: Coordinate; warning?: string }
  | { ok: false; errors: { latitude?: string; longitude?: string; both?: string } };

/** Validates a typed latitude/longitude pair (decimal degrees, as on a map app). */
export function parseCoordinatePair(latitude: string, longitude: string): CoordinateResult {
  const lat = parseCoordinate(latitude, "latitude");
  const lng = parseCoordinate(longitude, "longitude");
  if (!lat.ok || !lng.ok) {
    return { ok: false, errors: { latitude: lat.ok ? undefined : lat.message, longitude: lng.ok ? undefined : lng.message } };
  }
  if (lat.value === 0 && lng.value === 0) return { ok: false, errors: { both: "0, 0 is a placeholder, not a location." } };
  const coordinate = { lat: lat.value, lng: lng.value };
  return isInsideServiceArea(coordinate)
    ? { ok: true, coordinate }
    : { ok: true, coordinate, warning: "This point is outside the Butuan City area. Check that latitude and longitude are not swapped." };
}

export type GeometryTextResult =
  | { ok: true; lines: Coordinate[][]; warnings: string[] }
  | { ok: false; errors: string[] };

/**
 * Parses geometry typed or pasted by an administrator:
 *  - GeoJSON (LineString, MultiLineString, or a Feature wrapping one), where
 *    pairs are [longitude, latitude];
 *  - plain text, one "latitude, longitude" pair per line, with a blank line
 *    between separate lines.
 * Nothing is inferred or repaired; any bad value is an error with its line.
 */
export function parseGeometryText(text: string): GeometryTextResult {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: true, lines: [], warnings: [] };

  if (trimmed.startsWith("{")) {
    let json: unknown;
    try {
      json = JSON.parse(trimmed);
    } catch {
      return { ok: false, errors: ["That looks like GeoJSON but is not valid JSON."] };
    }
    const geometry = (json as { type?: string; geometry?: unknown })?.type === "Feature" ? (json as { geometry: unknown }).geometry : json;
    const lines = parseLineGeometry(geometry);
    if (lines.length === 0) {
      return { ok: false, errors: ["Expected a LineString or MultiLineString with at least two [longitude, latitude] pairs per line, all within range."] };
    }
    return { ok: true, lines, warnings: outsideWarning(lines) };
  }

  const errors: string[] = [];
  const lines: Coordinate[][] = [];
  let current: Coordinate[] = [];
  const flush = (lineNo: number) => {
    if (current.length === 1) errors.push(`The line ending before line ${lineNo} has only one point. A line needs at least two.`);
    else if (current.length > 1) lines.push(current);
    current = [];
  };
  text.split(/\r?\n/).forEach((raw, i) => {
    const row = raw.trim();
    if (row === "" || row === "---") return flush(i + 1);
    const parts = row.split(/[\s,;]+/).filter(Boolean);
    if (parts.length !== 2) {
      errors.push(`Line ${i + 1}: expected "latitude, longitude" but found ${parts.length} value${parts.length === 1 ? "" : "s"}.`);
      return;
    }
    const pair = parseCoordinatePair(parts[0], parts[1]);
    if (!pair.ok) {
      errors.push(`Line ${i + 1}: ${Object.values(pair.errors).filter(Boolean).join(" ")}`);
      return;
    }
    current.push(pair.coordinate);
  });
  flush(text.split(/\r?\n/).length + 1);

  if (errors.length > 0) return { ok: false, errors };
  if (lines.length === 0) return { ok: false, errors: ["Enter at least two points."] };
  return { ok: true, lines, warnings: outsideWarning(lines) };
}

function outsideWarning(lines: Coordinate[][]): string[] {
  return lines.some((l) => l.some((p) => !isInsideServiceArea(p)))
    ? ["Some points are outside the Butuan City area. Check for swapped latitude/longitude."]
    : [];
}

/** Text form of lines, the inverse of parseGeometryText's plain format. */
export function linesToText(lines: readonly (readonly Coordinate[])[]): string {
  return lines.map((l) => l.map((c) => `${round6(c.lat)}, ${round6(c.lng)}`).join("\n")).join("\n\n");
}
