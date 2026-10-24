import { isInsideServiceArea } from "@/lib/constants";
import { distanceMeters } from "@/lib/routes/geometry";
import { parseCsv, type CsvRow } from "@/lib/import/csv";

export const IMPORT_KINDS = ["stops", "routes", "route_stops", "fare_rules"] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

/**
 * Accepted columns. Anything else is rejected, in particular any attempt to
 * set a verification status: imported data is always a draft, unverified.
 */
export const COLUMNS: Record<ImportKind, { required: string[]; optional: string[] }> = {
  stops: {
    required: ["ref", "name", "latitude", "longitude"],
    optional: ["barangay", "landmark_description", "pickup_allowed", "dropoff_allowed", "sample"],
  },
  routes: {
    required: ["ref", "name", "transport_type"],
    optional: ["code", "description", "origin_label", "destination_label", "sample"],
  },
  route_stops: {
    required: ["direction", "stop_order"],
    optional: ["route_ref", "route_id", "stop_ref", "stop_id", "boarding_allowed", "dropoff_allowed"],
  },
  fare_rules: {
    required: ["passenger_type", "amount", "effective_from"],
    optional: [
      "route_ref", "route_id", "from_stop_ref", "from_stop_id", "to_stop_ref", "to_stop_id",
      "effective_until", "source_description",
    ],
  },
};

export type Severity = "error" | "warning";
export type Issue = {
  file: ImportKind | "batch";
  /** Line in the CSV (header is line 1); null for file-level problems. */
  line: number | null;
  column?: string;
  severity: Severity;
  message: string;
};

export type ExistingData = {
  stops: { id: string; name: string; latitude: number; longitude: number }[];
  routes: { id: string; code: string | null; name: string; transport_type: string; verification_status: string }[];
  /** Only for routes referenced by UUID in the import. */
  routeStops: { route_id: string; direction: string; stop_id: string }[];
  fares: {
    route_id: string;
    from_stop_id: string | null;
    to_stop_id: string | null;
    passenger_type: string;
    effective_from: string;
    effective_until: string | null;
  }[];
};

export const EMPTY_EXISTING: ExistingData = { stops: [], routes: [], routeStops: [], fares: [] };

export type ImportFileInput = { name: string; text: string };
export type ImportFiles = Partial<Record<ImportKind, ImportFileInput>>;

type Row = { line: number; v: Record<string, string> };
export type ParsedFile = { kind: ImportKind; name: string; headers: string[]; rows: Row[] };
export type ParsedImport = { files: Partial<Record<ImportKind, ParsedFile>>; issues: Issue[] };

export type CommitPayload = {
  stops: Record<string, unknown>[];
  routes: Record<string, unknown>[];
  route_stops: Record<string, unknown>[];
  fares: Record<string, unknown>[];
};

export type PreviewRow = { line: number; cells: string[]; level: "ok" | "warning" | "error" };
export type ImportReport = {
  ok: boolean;
  issues: Issue[];
  counts: Record<ImportKind, number>;
  preview: Partial<Record<ImportKind, { headers: string[]; rows: PreviewRow[]; truncated: boolean }>>;
  /** Present only when there are no errors. */
  payload: CommitPayload | null;
};

export const PREVIEW_ROWS = 50;

// ---------------------------------------------------------------------------
// Parsing and header checks
// ---------------------------------------------------------------------------

export function parseImportFiles(files: ImportFiles): ParsedImport {
  const issues: Issue[] = [];
  const parsed: ParsedImport["files"] = {};

  for (const kind of IMPORT_KINDS) {
    const file = files[kind];
    if (!file) continue;
    const csv = parseCsv(file.text);
    if (!csv.ok) {
      issues.push({ file: kind, line: null, severity: "error", message: csv.error });
      continue;
    }
    const { required, optional } = COLUMNS[kind];
    const allowed = new Set([...required, ...optional]);
    let headerOk = true;

    const seen = new Set<string>();
    for (const h of csv.headers) {
      if (h === "") {
        issues.push({ file: kind, line: 1, severity: "error", message: "The header row has an empty column name." });
        headerOk = false;
      } else if (seen.has(h)) {
        issues.push({ file: kind, line: 1, column: h, severity: "error", message: `Column "${h}" appears more than once.` });
        headerOk = false;
      } else if (!allowed.has(h)) {
        const hint = /verif|status|verified/.test(h)
          ? " Imported data is always saved as an unverified draft; verification is done in the route editor."
          : "";
        issues.push({ file: kind, line: 1, column: h, severity: "error", message: `Unknown column "${h}".${hint}` });
        headerOk = false;
      }
      seen.add(h);
    }
    for (const col of required) {
      if (!seen.has(col)) {
        issues.push({ file: kind, line: 1, column: col, severity: "error", message: `Required column "${col}" is missing.` });
        headerOk = false;
      }
    }
    if (kind === "route_stops") {
      if (!seen.has("route_ref") && !seen.has("route_id")) {
        issues.push({ file: kind, line: 1, severity: "error", message: 'Needs a "route_ref" or "route_id" column.' });
        headerOk = false;
      }
      if (!seen.has("stop_ref") && !seen.has("stop_id")) {
        issues.push({ file: kind, line: 1, severity: "error", message: 'Needs a "stop_ref" or "stop_id" column.' });
        headerOk = false;
      }
    }
    if (kind === "fare_rules" && !seen.has("route_ref") && !seen.has("route_id")) {
      issues.push({ file: kind, line: 1, severity: "error", message: 'Needs a "route_ref" or "route_id" column.' });
      headerOk = false;
    }
    if (!headerOk) {
      parsed[kind] = { kind, name: file.name, headers: csv.headers, rows: [] };
      continue;
    }

    const rows: Row[] = [];
    for (const r of csv.rows as CsvRow[]) {
      if (r.cells.length > csv.headers.length) {
        issues.push({ file: kind, line: r.line, severity: "error", message: `Row has ${r.cells.length} values but the header has ${csv.headers.length} columns.` });
        continue;
      }
      const v: Record<string, string> = {};
      csv.headers.forEach((h, i) => (v[h] = r.cells[i] ?? ""));
      rows.push({ line: r.line, v });
    }
    parsed[kind] = { kind, name: file.name, headers: csv.headers, rows };
  }
  return { files: parsed, issues };
}

/** Route UUIDs the import refers to, so the caller can load their current stops and fares. */
export function referencedRouteIds(parsed: ParsedImport): string[] {
  const ids = new Set<string>();
  for (const kind of ["route_stops", "fare_rules"] as const) {
    for (const row of parsed.files[kind]?.rows ?? []) {
      const id = row.v.route_id?.toLowerCase();
      if (id && UUID.test(id)) ids.add(id);
    }
  }
  return [...ids];
}

// ---------------------------------------------------------------------------
// Value parsing
// ---------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REF = /^[A-Za-z0-9_.-]{1,50}$/;
const DECIMAL = /^-?\d{1,3}(\.\d+)?$/;
const AMOUNT = /^\d{1,6}(\.\d{1,2})?$/;
const SAMPLE_NAME = /^\s*\[?\s*sample\b/i;

type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };
const ok = <T,>(value: T): Parsed<T> => ({ ok: true, value });
const bad = (message: string): Parsed<never> => ({ ok: false, message });

export function parseBool(raw: string, fallback: boolean | null): Parsed<boolean | null> {
  const t = raw.trim().toLowerCase();
  if (t === "") return ok(fallback);
  if (["true", "yes", "y", "1"].includes(t)) return ok(true);
  if (["false", "no", "n", "0"].includes(t)) return ok(false);
  return bad(`"${raw}" is not a yes/no value (use true or false).`);
}

export function parseAmount(raw: string): Parsed<number> {
  const t = raw.trim();
  if (t === "") return bad("The fare amount is required.");
  if (t.startsWith("-")) return bad(`Fare "${raw}" is negative.`);
  if (!AMOUNT.test(t)) return bad(`Fare "${raw}" is not a plain amount like 12 or 12.50 (no currency symbol, commas or exponent; at most 2 decimals).`);
  return ok(Number(t));
}

export function parseIsoDate(raw: string): Parsed<string> {
  const t = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return bad(`"${raw}" is not a date in YYYY-MM-DD form.`);
  const d = new Date(`${t}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== t) return bad(`"${raw}" is not a real calendar date.`);
  return ok(t);
}

export function parseCoordinate(raw: string, axis: "latitude" | "longitude"): Parsed<number> {
  const t = raw.trim();
  if (t === "") return bad(`${axis} is required.`);
  if (!DECIMAL.test(t)) return bad(`${axis} "${raw}" is not a decimal number.`);
  const n = Number(t);
  const max = axis === "latitude" ? 90 : 180;
  if (Math.abs(n) > max) return bad(`${axis} ${n} is outside -${max} to ${max}.`);
  return ok(n);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

type RouteKey = string; // "ref:<ref>" or "id:<uuid>"

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

export function validateImport(parsed: ParsedImport, existing: ExistingData): ImportReport {
  const issues: Issue[] = [...parsed.issues];
  const add = (file: ImportKind, line: number | null, severity: Severity, message: string, column?: string) =>
    issues.push({ file, line, severity, message, ...(column ? { column } : {}) });
  const err = (file: ImportKind, line: number, message: string, column?: string) => add(file, line, "error", message, column);
  const warn = (file: ImportKind, line: number, message: string, column?: string) => add(file, line, "warning", message, column);

  const payload: CommitPayload = { stops: [], routes: [], route_stops: [], fares: [] };
  const existingStopIds = new Set(existing.stops.map((s) => s.id.toLowerCase()));
  const existingRoutes = new Map(existing.routes.map((r) => [r.id.toLowerCase(), r]));

  // ---- stops --------------------------------------------------------------
  const stopRefs = new Set<string>();
  const newStops: { ref: string; name: string; lat: number; lng: number; line: number }[] = [];
  for (const { line, v } of parsed.files.stops?.rows ?? []) {
    let valid = true;
    const fail = (m: string, c?: string) => (err("stops", line, m, c), (valid = false));

    const ref = v.ref;
    if (!REF.test(ref)) fail(`ref "${ref}" must be 1-50 letters, digits, "_", "." or "-".`, "ref");
    else if (stopRefs.has(ref)) fail(`ref "${ref}" is used by more than one stop.`, "ref");
    if (ref) stopRefs.add(ref);

    if (v.name === "") fail("name is required.", "name");
    else if (v.name.length > 200) fail("name is longer than 200 characters.", "name");
    const lat = parseCoordinate(v.latitude, "latitude");
    const lng = parseCoordinate(v.longitude, "longitude");
    if (!lat.ok) fail(lat.message, "latitude");
    if (!lng.ok) fail(lng.message, "longitude");
    const pickup = parseBool(v.pickup_allowed ?? "", true);
    const dropoff = parseBool(v.dropoff_allowed ?? "", true);
    const sampleFlag = parseBool(v.sample ?? "", false);
    if (!pickup.ok) fail(pickup.message, "pickup_allowed");
    if (!dropoff.ok) fail(dropoff.message, "dropoff_allowed");
    if (!sampleFlag.ok) fail(sampleFlag.message, "sample");
    if (!valid || !lat.ok || !lng.ok || !pickup.ok || !dropoff.ok || !sampleFlag.ok) continue;

    if (lat.value === 0 && lng.value === 0) {
      fail("Coordinates 0,0 are a placeholder, not a location.", "latitude");
      continue;
    }
    if (!isInsideServiceArea({ lat: lat.value, lng: lng.value })) {
      warn("stops", line, "These coordinates are outside the Butuan City area. Check for swapped or mistyped values.", "latitude");
    }

    // Duplicates against stops already in the database and earlier rows.
    const here = { lat: lat.value, lng: lng.value };
    const name = norm(v.name);
    const others = [
      ...existing.stops.map((s) => ({ label: `existing stop ${s.id}`, name: norm(s.name), pos: { lat: s.latitude, lng: s.longitude } })),
      ...newStops.map((s) => ({ label: `stop on line ${s.line}`, name: norm(s.name), pos: { lat: s.lat, lng: s.lng } })),
    ];
    for (const o of others) {
      const d = distanceMeters(here, o.pos);
      if (name === o.name && d <= 10) {
        fail(`Duplicate of ${o.label} (same name, ${Math.round(d)} m apart). Use its UUID in route_stops instead of importing it again.`, "name");
        break;
      }
      if (name === o.name && d <= 150) warn("stops", line, `Possible duplicate of ${o.label}: same name, ${Math.round(d)} m apart.`, "name");
      else if (d <= 5) warn("stops", line, `Very close (${Math.round(d)} m) to ${o.label} (“${o.name}”). Is this the same stop?`, "name");
    }
    if (!valid) continue;

    const sample = sampleFlag.value === true || SAMPLE_NAME.test(v.name);
    if (sample) warn("stops", line, "Marked as a sample stop: it can never be verified or published.");
    newStops.push({ ref, name: v.name, lat: lat.value, lng: lng.value, line });
    payload.stops.push({
      ref, name: v.name, latitude: lat.value, longitude: lng.value,
      barangay: v.barangay ?? "", landmark_description: v.landmark_description ?? "",
      pickup_allowed: pickup.value, dropoff_allowed: dropoff.value, is_sample: sample,
    });
  }

  // ---- routes -------------------------------------------------------------
  const routeRefs = new Set<string>();
  const seenCodes = new Map<string, number>();
  const seenNameType = new Map<string, number>();
  const existingCodes = new Map(existing.routes.filter((r) => r.code).map((r) => [r.code!.toLowerCase(), r.id]));
  for (const { line, v } of parsed.files.routes?.rows ?? []) {
    let valid = true;
    const fail = (m: string, c?: string) => (err("routes", line, m, c), (valid = false));

    if (!REF.test(v.ref)) fail(`ref "${v.ref}" must be 1-50 letters, digits, "_", "." or "-".`, "ref");
    else if (routeRefs.has(v.ref)) fail(`ref "${v.ref}" is used by more than one route.`, "ref");
    if (v.ref) routeRefs.add(v.ref);

    if (v.name === "") fail("name is required.", "name");
    else if (v.name.length > 200) fail("name is longer than 200 characters.", "name");
    if (v.transport_type !== "minibus" && v.transport_type !== "multicab") {
      fail(`transport_type "${v.transport_type}" must be minibus or multicab.`, "transport_type");
    }
    const code = (v.code ?? "").trim();
    if (code) {
      const key = code.toLowerCase();
      if (code.length > 50) fail("code is longer than 50 characters.", "code");
      else if (seenCodes.has(key)) fail(`code "${code}" is already used on line ${seenCodes.get(key)}.`, "code");
      else if (existingCodes.has(key)) fail(`code "${code}" already exists in the database (route ${existingCodes.get(key)}). Imports never overwrite existing routes.`, "code");
      seenCodes.set(key, line);
    }
    const sampleFlag = parseBool(v.sample ?? "", false);
    if (!sampleFlag.ok) fail(sampleFlag.message, "sample");
    if (!valid || !sampleFlag.ok) continue;

    const nameType = `${norm(v.name)}|${v.transport_type}`;
    const dupInDb = existing.routes.find((r) => norm(r.name) === norm(v.name) && r.transport_type === v.transport_type);
    if (dupInDb) warn("routes", line, `A ${v.transport_type} route named “${dupInDb.name}” already exists (${dupInDb.id}). Is this a duplicate?`, "name");
    else if (seenNameType.has(nameType)) warn("routes", line, `Same name and type as the route on line ${seenNameType.get(nameType)}.`, "name");
    seenNameType.set(nameType, line);

    const sample = sampleFlag.value === true || SAMPLE_NAME.test(v.name) || SAMPLE_NAME.test(code);
    if (sample) warn("routes", line, "Marked as a sample route: it can never be verified or published.");
    payload.routes.push({
      ref: v.ref, code, name: v.name, transport_type: v.transport_type,
      description: v.description ?? "", origin_label: v.origin_label ?? "", destination_label: v.destination_label ?? "",
      is_sample: sample,
    });
  }

  // ---- reference helpers --------------------------------------------------
  type Resolved<T> = { ok: true; key: T; field: Record<string, string> } | { ok: false };

  function resolveRoute(file: ImportKind, line: number, v: Record<string, string>, requireDraft: boolean): Resolved<RouteKey> {
    const ref = v.route_ref ?? "";
    const id = (v.route_id ?? "").toLowerCase();
    if ((ref !== "") === (id !== "")) {
      err(file, line, ref && id ? "Give either route_ref or route_id, not both." : "Give a route_ref or a route_id.", "route_ref");
      return { ok: false };
    }
    if (ref) {
      if (!routeRefs.has(ref)) {
        err(file, line, `route_ref "${ref}" is not in routes.csv.`, "route_ref");
        return { ok: false };
      }
      return { ok: true, key: `ref:${ref}`, field: { route_ref: ref } };
    }
    if (!UUID.test(id)) {
      err(file, line, `route_id "${v.route_id}" is not a valid UUID.`, "route_id");
      return { ok: false };
    }
    const route = existingRoutes.get(id);
    if (!route) {
      err(file, line, `route_id ${id} does not exist.`, "route_id");
      return { ok: false };
    }
    if (requireDraft && route.verification_status === "verified") {
      err(file, line, `Route ${id} is verified. Edit it in the route editor; imports never change verified routes.`, "route_id");
      return { ok: false };
    }
    return { ok: true, key: `id:${id}`, field: { route_id: id } };
  }

  function resolveStop(file: ImportKind, line: number, v: Record<string, string>, prefix: "" | "from_" | "to_", required: boolean): Resolved<string> | "none" {
    const refCol = `${prefix}stop_ref`;
    const idCol = `${prefix}stop_id`;
    const ref = v[refCol] ?? "";
    const id = (v[idCol] ?? "").toLowerCase();
    if (!ref && !id) {
      if (required) err(file, line, `Give a ${refCol} or a ${idCol}.`, refCol);
      return required ? { ok: false } : "none";
    }
    if (ref && id) {
      err(file, line, `Give either ${refCol} or ${idCol}, not both.`, refCol);
      return { ok: false };
    }
    if (ref) {
      if (!stopRefs.has(ref)) {
        err(file, line, `${refCol} "${ref}" is not in stops.csv.`, refCol);
        return { ok: false };
      }
      return { ok: true, key: `ref:${ref}`, field: { [refCol]: ref } };
    }
    if (!UUID.test(id)) {
      err(file, line, `${idCol} "${v[idCol]}" is not a valid UUID.`, idCol);
      return { ok: false };
    }
    if (!existingStopIds.has(id)) {
      err(file, line, `${idCol} ${id} does not exist.`, idCol);
      return { ok: false };
    }
    return { ok: true, key: `id:${id}`, field: { [idCol]: id } };
  }

  // ---- route_stops --------------------------------------------------------
  type Seq = { line: number; order: number; stopKey: string };
  const sequences = new Map<string, Seq[]>(); // `${routeKey}|${direction}`
  const stopsOnRoute = new Map<RouteKey, Set<string>>();
  const occupied = new Set(existing.routeStops.map((rs) => `id:${rs.route_id.toLowerCase()}|${rs.direction}`));
  for (const rs of existing.routeStops) {
    const k = `id:${rs.route_id.toLowerCase()}`;
    if (!stopsOnRoute.has(k)) stopsOnRoute.set(k, new Set());
    stopsOnRoute.get(k)!.add(`id:${rs.stop_id.toLowerCase()}`);
  }

  for (const { line, v } of parsed.files.route_stops?.rows ?? []) {
    let valid = true;
    const route = resolveRoute("route_stops", line, v, true);
    const stop = resolveStop("route_stops", line, v, "", true) as Resolved<string>;
    if (!route.ok || !stop.ok) valid = false;

    if (v.direction !== "outbound" && v.direction !== "inbound") {
      err("route_stops", line, `direction "${v.direction}" must be outbound or inbound.`, "direction");
      valid = false;
    }
    const order = Number(v.stop_order);
    if (!/^\d+$/.test(v.stop_order) || order < 1 || order > 999) {
      err("route_stops", line, `stop_order "${v.stop_order}" must be a whole number from 1 to 999.`, "stop_order");
      valid = false;
    }
    const boarding = parseBool(v.boarding_allowed ?? "", null);
    const dropoff = parseBool(v.dropoff_allowed ?? "", null);
    if (!boarding.ok) {
      err("route_stops", line, boarding.message, "boarding_allowed");
      valid = false;
    }
    if (!dropoff.ok) {
      err("route_stops", line, dropoff.message, "dropoff_allowed");
      valid = false;
    }
    if (!valid || !route.ok || !stop.ok || !boarding.ok || !dropoff.ok) continue;

    if (route.key.startsWith("id:") && occupied.has(`${route.key}|${v.direction}`)) {
      err("route_stops", line, `That route already has ${v.direction} stops. Imports never replace or reorder existing stops; use the route editor.`, "route_id");
      continue;
    }
    const seqKey = `${route.key}|${v.direction}`;
    if (!sequences.has(seqKey)) sequences.set(seqKey, []);
    sequences.get(seqKey)!.push({ line, order, stopKey: stop.key });
    if (!stopsOnRoute.has(route.key)) stopsOnRoute.set(route.key, new Set());
    stopsOnRoute.get(route.key)!.add(stop.key);

    payload.route_stops.push({
      ...route.field, ...stop.field, direction: v.direction, stop_order: order,
      boarding_allowed: boarding.value, dropoff_allowed: dropoff.value,
    });
  }

  for (const [seqKey, seq] of sequences) {
    const label = seqKey.replace("|", " / ");
    const byOrder = new Map<number, Seq>();
    const byStop = new Map<string, Seq>();
    let broken = false;
    for (const s of [...seq].sort((a, b) => a.order - b.order || a.line - b.line)) {
      if (byOrder.has(s.order)) {
        err("route_stops", s.line, `stop_order ${s.order} is used twice for ${label} (also line ${byOrder.get(s.order)!.line}).`, "stop_order");
        broken = true;
      } else byOrder.set(s.order, s);
      if (byStop.has(s.stopKey)) {
        err("route_stops", s.line, `The same stop appears twice for ${label} (also line ${byStop.get(s.stopKey)!.line}). A stop can appear once per direction.`, "stop_ref");
        broken = true;
      } else byStop.set(s.stopKey, s);
    }
    if (!broken) {
      const orders = [...byOrder.keys()].sort((a, b) => a - b);
      for (let i = 0; i < orders.length; i++) {
        if (orders[i] !== i + 1) {
          err("route_stops", byOrder.get(orders[i])!.line, `Stop positions for ${label} must run 1, 2, 3… without gaps; position ${i + 1} is missing.`, "stop_order");
          break;
        }
      }
    }
  }

  // Direction sanity for routes created by this import.
  for (const route of payload.routes) {
    const key = `ref:${route.ref}`;
    const hasOut = sequences.has(`${key}|outbound`);
    const hasIn = sequences.has(`${key}|inbound`);
    const line = parsed.files.routes!.rows.find((r) => r.v.ref === route.ref)?.line ?? null;
    if (!hasOut && hasIn && line) err("routes", line, `Route "${route.ref}" has inbound stops but no outbound stops.`);
    else if (!hasOut && line) warn("routes", line, `Route "${route.ref}" has no stops in this import. It will be created as an incomplete draft.`);
  }

  // ---- fare_rules ---------------------------------------------------------
  type FareSpan = { line: number; from: string; until: string };
  const fareSpans = new Map<string, FareSpan[]>();
  for (const f of existing.fares) {
    const k = `id:${f.route_id.toLowerCase()}|${f.from_stop_id?.toLowerCase() ?? ""}|${f.to_stop_id?.toLowerCase() ?? ""}|${f.passenger_type}`;
    if (!fareSpans.has(k)) fareSpans.set(k, []);
    fareSpans.get(k)!.push({ line: 0, from: f.effective_from, until: f.effective_until ?? "9999-12-31" });
  }

  for (const { line, v } of parsed.files.fare_rules?.rows ?? []) {
    let valid = true;
    const fail = (m: string, c?: string) => (err("fare_rules", line, m, c), (valid = false));
    const route = resolveRoute("fare_rules", line, v, true);
    if (!route.ok) valid = false;
    const from = resolveStop("fare_rules", line, v, "from_", false);
    const to = resolveStop("fare_rules", line, v, "to_", false);
    if ((from !== "none" && !from.ok) || (to !== "none" && !to.ok)) valid = false;
    if ((from === "none") !== (to === "none")) fail("Give both an origin and a destination stop, or neither for a flat route fare.", from === "none" ? "from_stop_ref" : "to_stop_ref");

    if (!["regular", "student", "senior", "pwd"].includes(v.passenger_type)) {
      fail(`passenger_type "${v.passenger_type}" must be regular, student, senior or pwd.`, "passenger_type");
    }
    const amount = parseAmount(v.amount);
    if (!amount.ok) fail(amount.message, "amount");
    const eff = parseIsoDate(v.effective_from);
    if (!eff.ok) fail(eff.message, "effective_from");
    const until = (v.effective_until ?? "") === "" ? null : parseIsoDate(v.effective_until);
    if (until && !until.ok) fail(until.message, "effective_until");
    if (eff.ok && until?.ok && until.value < eff.value) fail("effective_until is before effective_from.", "effective_until");
    if (!valid || !route.ok || !amount.ok || !eff.ok || (until && !until.ok)) continue;

    const fromKey = from === "none" ? "" : (from as { ok: true; key: string }).key;
    const toKey = to === "none" ? "" : (to as { ok: true; key: string }).key;
    if (fromKey && fromKey === toKey) {
      fail("The origin and destination stop are the same.", "to_stop_ref");
      continue;
    }
    const onRoute = stopsOnRoute.get(route.key);
    for (const [col, key] of [["from_stop", fromKey], ["to_stop", toKey]] as const) {
      if (key && !onRoute?.has(key)) fail(`The ${col.replace("_", " ")} is not on this route (add it in route_stops first).`, `${col}_ref`);
    }
    if (!valid) continue;
    if (amount.value === 0) warn("fare_rules", line, "The fare is 0. Is the route really free?", "amount");

    const untilValue = until && until.ok ? until.value : "9999-12-31";
    const spanKey = `${route.key}|${fromKey.replace(/^id:/, "")}|${toKey.replace(/^id:/, "")}|${v.passenger_type}`;
    const spans = fareSpans.get(spanKey) ?? [];
    const clash = spans.find((s) => s.from <= untilValue && eff.value <= s.until);
    if (clash) {
      fail(
        clash.line ? `This fare period overlaps the fare on line ${clash.line} for the same route, stops and passenger type.` : "This fare period overlaps an existing fare for the same route, stops and passenger type. Imports never overwrite fares.",
        "effective_from",
      );
      continue;
    }
    spans.push({ line, from: eff.value, until: untilValue });
    fareSpans.set(spanKey, spans);

    payload.fares.push({
      ...route.field,
      ...(from === "none" ? {} : (from as { field: object }).field),
      ...(to === "none" ? {} : (to as { field: object }).field),
      passenger_type: v.passenger_type, amount: amount.value, effective_from: eff.value,
      effective_until: until && until.ok ? until.value : "",
      source_description: v.source_description ?? "",
    });
  }

  // ---- report -------------------------------------------------------------
  issues.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1));
  const hasErrors = issues.some((i) => i.severity === "error");
  const total = IMPORT_KINDS.reduce((n, k) => n + (parsed.files[k]?.rows.length ?? 0), 0);

  const preview: ImportReport["preview"] = {};
  for (const kind of IMPORT_KINDS) {
    const file = parsed.files[kind];
    if (!file) continue;
    const levels = new Map<number, "warning" | "error">();
    for (const i of issues) {
      if (i.file !== kind || i.line === null) continue;
      if (i.severity === "error" || !levels.has(i.line)) levels.set(i.line, i.severity);
    }
    preview[kind] = {
      headers: file.headers,
      truncated: file.rows.length > PREVIEW_ROWS,
      rows: file.rows.slice(0, PREVIEW_ROWS).map((r) => ({
        line: r.line,
        cells: file.headers.map((h) => r.v[h] ?? ""),
        level: levels.get(r.line) ?? "ok",
      })),
    };
  }

  if (total === 0 && !issues.some((i) => i.severity === "error")) {
    issues.push({ file: "batch", line: null, severity: "error", message: "Choose at least one CSV file with at least one data row." });
  }
  const finalErrors = issues.some((i) => i.severity === "error");

  return {
    ok: !finalErrors,
    issues,
    counts: {
      stops: payload.stops.length,
      routes: payload.routes.length,
      route_stops: payload.route_stops.length,
      fare_rules: payload.fares.length,
    },
    preview,
    payload: finalErrors || hasErrors ? null : payload,
  };
}
