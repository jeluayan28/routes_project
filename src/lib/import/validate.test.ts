import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  EMPTY_EXISTING,
  IMPORT_KINDS,
  parseAmount,
  parseBool,
  parseCoordinate,
  parseImportFiles,
  parseIsoDate,
  referencedRouteIds,
  validateImport,
  type ExistingData,
  type ImportFiles,
  type ImportKind,
} from "./validate";

const FIXTURES = path.resolve(import.meta.dirname, "../../dev-fixtures/import");
const fixture = (kind: ImportKind) => ({ name: `${kind}.csv`, text: readFileSync(path.join(FIXTURES, `${kind}.csv`), "utf8") });
const fixtureFiles = (): ImportFiles => Object.fromEntries(IMPORT_KINDS.map((k) => [k, fixture(k)]));

const run = (files: ImportFiles, existing: ExistingData = EMPTY_EXISTING) => validateImport(parseImportFiles(files), existing);
const csv = (...lines: string[]) => ({ name: "t.csv", text: lines.join("\n") + "\n" });

const errors = (r: ReturnType<typeof run>) => r.issues.filter((i) => i.severity === "error");
const warnings = (r: ReturnType<typeof run>) => r.issues.filter((i) => i.severity === "warning");
const hasError = (r: ReturnType<typeof run>, re: RegExp, line?: number) =>
  errors(r).some((i) => re.test(i.message) && (line === undefined || i.line === line));

// In-service-area fictional coordinates so tests are not drowned in warnings.
const STOPS = csv("ref,name,latitude,longitude", "A,Alpha Stop,8.9500,125.5400", "B,Bravo Stop,8.9600,125.5500", "C,Charlie Stop,8.9700,125.5600");
const ROUTES = csv("ref,name,transport_type,code", "R,Test Route,minibus,T-1");
const RS = (...rows: string[]) => csv("route_ref,direction,stop_order,stop_ref", ...rows);
const GOOD_RS = RS("R,outbound,1,A", "R,outbound,2,B", "R,outbound,3,C");
const base = (over: ImportFiles = {}): ImportFiles => ({ stops: STOPS, routes: ROUTES, route_stops: GOOD_RS, ...over });

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const existing = (over: Partial<ExistingData> = {}): ExistingData => ({ ...EMPTY_EXISTING, ...over });
const dbRoute = (id = U1, over: Record<string, string | null> = {}) => ({
  id, code: null, name: "Existing Route", transport_type: "minibus", verification_status: "unverified", ...over,
});

describe("the sample fixture", () => {
  it("is valid, previewable, and flagged as sample", () => {
    const r = run(fixtureFiles());
    expect(errors(r)).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.counts).toEqual({ stops: 3, routes: 1, route_stops: 5, fare_rules: 2 });
    expect(r.payload!.routes[0]).toMatchObject({ is_sample: true, ref: "R1" });
    expect(r.payload!.stops.every((s) => s.is_sample === true)).toBe(true);
    expect(warnings(r).some((w) => /sample route/.test(w.message))).toBe(true);
    expect(r.preview.stops!.rows).toHaveLength(3);
  });

  it("warns that placeholder coordinates are outside Butuan", () => {
    expect(warnings(run(fixtureFiles())).some((w) => /outside the Butuan City area/.test(w.message))).toBe(true);
  });

  it("treats a [SAMPLE]/SAMPLE name as a sample even without the column", () => {
    const r = run(base({ routes: csv("ref,name,transport_type", "R,[Sample] Thing,minibus") }));
    expect(r.payload!.routes[0].is_sample).toBe(true);
  });
});

describe("a valid import", () => {
  it("builds a payload that is only drafts (no verification fields at all)", () => {
    const r = run(base());
    expect(r.ok).toBe(true);
    const json = JSON.stringify(r.payload);
    expect(json).not.toMatch(/verif|status/);
    expect(r.payload!.route_stops[0]).toMatchObject({ route_ref: "R", stop_ref: "A", direction: "outbound", stop_order: 1 });
  });

  it("is a pure check: nothing is committed and the payload is withheld on error", () => {
    const r = run(base({ stops: csv("ref,name,latitude,longitude", "A,Alpha,95,125.5") }));
    expect(r.ok).toBe(false);
    expect(r.payload).toBeNull();
  });

  it("requires at least one file with data", () => {
    expect(run({}).ok).toBe(false);
    expect(run({ stops: csv("ref,name,latitude,longitude") }).ok).toBe(false);
  });
});

describe("column validation", () => {
  it("rejects unknown columns, with a hint for verification columns", () => {
    const r = run({ routes: csv("ref,name,transport_type,verification_status", "R,X,minibus,verified") });
    expect(hasError(r, /Unknown column "verification_status".*unverified draft/, 1)).toBe(true);
    expect(r.payload).toBeNull();
  });

  it("rejects missing required columns", () => {
    const r = run({ stops: csv("ref,name,latitude", "A,x,1") });
    expect(hasError(r, /Required column "longitude" is missing/)).toBe(true);
  });

  it("rejects duplicate and empty column names", () => {
    expect(hasError(run({ stops: csv("ref,name,name,latitude,longitude", "A,x,y,1,1") }), /appears more than once/)).toBe(true);
    expect(hasError(run({ stops: csv("ref,name,latitude,longitude,", "A,x,1,1,") }), /empty column name/)).toBe(true);
  });

  it("needs a way to identify the route and stop in route_stops and fare_rules", () => {
    expect(hasError(run({ route_stops: csv("direction,stop_order,stop_ref", "outbound,1,A") }), /route_ref.*route_id/)).toBe(true);
    expect(hasError(run({ route_stops: csv("route_ref,direction,stop_order", "R,outbound,1") }), /stop_ref.*stop_id/)).toBe(true);
    expect(hasError(run({ fare_rules: csv("passenger_type,amount,effective_from", "regular,1,2026-01-01") }), /route_ref.*route_id/)).toBe(true);
  });

  it("is case-insensitive about header names", () => {
    expect(run(base({ stops: csv("REF,Name,Latitude,LONGITUDE", "A,Alpha,8.95,125.54") })).counts.stops).toBe(1);
  });

  it("flags rows with too many values", () => {
    expect(hasError(run({ stops: csv("ref,name,latitude,longitude", "A,x,8.9,125.5,extra") }), /5 values but the header has 4/, 2)).toBe(true);
  });
});

describe("stops", () => {
  const stops = (...rows: string[]) => run({ stops: csv("ref,name,latitude,longitude", ...rows) });

  it.each([
    ["latitude above 90", "A,x,90.5,125.5", /latitude 90.5 is outside/],
    ["latitude below -90", "A,x,-91,125.5", /outside -90 to 90/],
    ["longitude above 180", "A,x,8.9,181", /longitude 181 is outside/],
    ["non-numeric latitude", "A,x,north,125.5", /not a decimal number/],
    ["a comma decimal", 'A,x,"8,9",125.5', /not a decimal number/],
    ["a missing latitude", "A,x,,125.5", /latitude is required/],
    ["exponent notation", "A,x,1e1,125.5", /not a decimal number/],
    ["0,0", "A,x,0,0", /placeholder/],
    ["a blank name", "A,,8.9,125.5", /name is required/],
    ["a bad ref", "bad ref!,x,8.9,125.5", /ref .* must be/],
  ])("rejects %s", (_n, row, re) => {
    expect(hasError(stops(row), re, 2)).toBe(true);
  });

  it("rejects a duplicate ref in the file", () => {
    expect(hasError(stops("A,One,8.9,125.5", "A,Two,8.91,125.51"), /ref "A" is used by more than one stop/, 3)).toBe(true);
  });

  it("rejects a same-name stop within 10 m, in the file", () => {
    expect(hasError(stops("A,Town Plaza,8.9500,125.5400", "B, town  plaza ,8.95003,125.54003"), /Duplicate of stop on line 2/, 3)).toBe(true);
  });

  it("rejects a same-name stop within 10 m of an existing stop, and names it", () => {
    const r = run({ stops: csv("ref,name,latitude,longitude", "A,Town Plaza,8.95,125.54") },
      existing({ stops: [{ id: U1, name: "town plaza", latitude: 8.95002, longitude: 125.54002 }] }));
    expect(hasError(r, new RegExp(`existing stop ${U1}`))).toBe(true);
  });

  it("only warns for a same-name stop 10-150 m away", () => {
    const r = run({ stops: csv("ref,name,latitude,longitude", "A,Town Plaza,8.9500,125.5400") },
      existing({ stops: [{ id: U1, name: "Town Plaza", latitude: 8.9509, longitude: 125.5400 }] }));
    expect(errors(r)).toEqual([]);
    expect(warnings(r).some((w) => /Possible duplicate/.test(w.message))).toBe(true);
  });

  it("warns about a different-named stop within 5 m", () => {
    const r = stops("A,One,8.95,125.54", "B,Two,8.950005,125.540005");
    expect(errors(r)).toEqual([]);
    expect(warnings(r).some((w) => /Very close/.test(w.message))).toBe(true);
  });

  it("parses yes/no columns and rejects nonsense", () => {
    const ok = run({ stops: csv("ref,name,latitude,longitude,pickup_allowed,dropoff_allowed", "A,x,8.95,125.54,no,Yes") });
    expect(ok.payload!.stops[0]).toMatchObject({ pickup_allowed: false, dropoff_allowed: true });
    expect(hasError(run({ stops: csv("ref,name,latitude,longitude,pickup_allowed", "A,x,8.95,125.54,maybe") }), /not a yes\/no value/)).toBe(true);
  });
});

describe("routes", () => {
  const routes = (...rows: string[]) => run({ routes: csv("ref,name,transport_type,code", ...rows) });

  it("rejects an unknown transport type", () => {
    expect(hasError(routes("R,X,tricycle,"), /must be minibus or multicab/, 2)).toBe(true);
  });

  it("rejects duplicate codes in the file (case-insensitively)", () => {
    expect(hasError(routes("R1,A,minibus,AB-1", "R2,B,minibus,ab-1"), /already used on line 2/, 3)).toBe(true);
  });

  it("rejects a code that already exists, without overwriting", () => {
    const r = run({ routes: csv("ref,name,transport_type,code", "R,X,minibus,EX-1") }, existing({ routes: [dbRoute(U1, { code: "ex-1" })] }));
    expect(hasError(r, /already exists in the database.*never overwrite/)).toBe(true);
  });

  it("warns about a probable duplicate name and type", () => {
    const r = run({ routes: csv("ref,name,transport_type", "R,existing  route,minibus") }, existing({ routes: [dbRoute()] }));
    expect(errors(r)).toEqual([]);
    expect(warnings(r).some((w) => /Is this a duplicate/.test(w.message))).toBe(true);
  });

  it("warns that a route without stops is incomplete, and rejects inbound without outbound", () => {
    expect(warnings(run({ routes: csv("ref,name,transport_type", "R,X,minibus") })).some((w) => /no stops in this import/.test(w.message))).toBe(true);
    const r = run(base({ route_stops: RS("R,inbound,1,A", "R,inbound,2,B") }));
    expect(hasError(r, /inbound stops but no outbound/)).toBe(true);
  });
});

describe("route_stops: references", () => {
  it("rejects unknown refs", () => {
    expect(hasError(run(base({ route_stops: RS("NOPE,outbound,1,A") })), /route_ref "NOPE" is not in routes.csv/, 2)).toBe(true);
    expect(hasError(run(base({ route_stops: RS("R,outbound,1,NOPE") })), /stop_ref "NOPE" is not in stops.csv/, 2)).toBe(true);
  });

  it("does not pile on follow-up errors when the referenced stop row itself is invalid", () => {
    const r = run(base({ stops: csv("ref,name,latitude,longitude", "A,Alpha,999,125.5", "B,Bravo,8.96,125.55", "C,Charlie,8.97,125.56") }));
    expect(errors(r).filter((e) => e.file === "route_stops")).toEqual([]);
  });

  it("validates UUIDs and checks they exist", () => {
    const csvStops = csv("route_id,direction,stop_order,stop_id", "not-a-uuid,outbound,1," + U2);
    expect(hasError(run({ route_stops: csvStops }), /not a valid UUID/)).toBe(true);
    const missing = csv("route_id,direction,stop_order,stop_id", `${U1},outbound,1,${U2}`);
    expect(hasError(run({ route_stops: missing }), /route_id .* does not exist/)).toBe(true);
    expect(hasError(run({ route_stops: missing }, existing({ routes: [dbRoute()] })), /stop_id .* does not exist/)).toBe(true);
  });

  it("accepts existing records by UUID, case-insensitively", () => {
    const r = run(
      { route_stops: csv("route_id,direction,stop_order,stop_id", `${U1.toUpperCase()},outbound,1,${U2}`) },
      existing({ routes: [dbRoute()], stops: [{ id: U2, name: "x", latitude: 8.9, longitude: 125.5 }] }),
    );
    expect(errors(r)).toEqual([]);
    expect(r.payload!.route_stops[0]).toMatchObject({ route_id: U1, stop_id: U2 });
    expect(referencedRouteIds(parseImportFiles({ route_stops: csv("route_id,direction,stop_order,stop_id", `${U1.toUpperCase()},outbound,1,${U2}`) }))).toEqual([U1]);
  });

  it("requires exactly one of route_ref / route_id per row", () => {
    const both = csv("route_ref,route_id,direction,stop_order,stop_ref", `R,${U1},outbound,1,A`);
    expect(hasError(run(base({ route_stops: both }), existing({ routes: [dbRoute()] })), /either route_ref or route_id/)).toBe(true);
    const neither = csv("route_ref,route_id,direction,stop_order,stop_ref", ",,outbound,1,A");
    expect(hasError(run(base({ route_stops: neither })), /Give a route_ref or a route_id/)).toBe(true);
  });

  it("refuses to touch a verified route or replace existing stops", () => {
    const row = csv("route_id,direction,stop_order,stop_id", `${U1},inbound,1,${U2}`);
    const stops = [{ id: U2, name: "x", latitude: 8.9, longitude: 125.5 }];
    expect(hasError(run({ route_stops: row }, existing({ routes: [dbRoute(U1, { verification_status: "verified" })], stops })), /is verified/)).toBe(true);
    const occupied = existing({ routes: [dbRoute()], stops, routeStops: [{ route_id: U1, direction: "inbound", stop_id: U2 }] });
    expect(hasError(run({ route_stops: row }, occupied), /already has inbound stops.*never replace/)).toBe(true);
    expect(errors(run({ route_stops: row }, existing({ routes: [dbRoute()], stops })))).toEqual([]);
  });
});

describe("route_stops: ordering and direction", () => {
  it("accepts rows in any file order as long as positions are 1..n", () => {
    expect(run(base({ route_stops: RS("R,outbound,3,C", "R,outbound,1,A", "R,outbound,2,B") })).ok).toBe(true);
  });

  it("rejects gaps", () => {
    expect(hasError(run(base({ route_stops: RS("R,outbound,1,A", "R,outbound,3,B") })), /position 2 is missing/, 3)).toBe(true);
  });

  it("rejects positions that do not start at 1", () => {
    expect(hasError(run(base({ route_stops: RS("R,outbound,2,A", "R,outbound,3,B") })), /position 1 is missing/)).toBe(true);
  });

  it("rejects a position used twice", () => {
    expect(hasError(run(base({ route_stops: RS("R,outbound,1,A", "R,outbound,1,B") })), /stop_order 1 is used twice/, 3)).toBe(true);
  });

  it("rejects the same stop twice in one direction, but allows it in the other", () => {
    expect(hasError(run(base({ route_stops: RS("R,outbound,1,A", "R,outbound,2,A") })), /same stop appears twice/)).toBe(true);
    expect(run(base({ route_stops: RS("R,outbound,1,A", "R,outbound,2,B", "R,inbound,1,B", "R,inbound,2,A") })).ok).toBe(true);
  });

  it.each([
    ["zero", "0"], ["negative", "-1"], ["a decimal", "1.5"], ["text", "first"], ["blank", ""], ["huge", "1000"],
  ])("rejects stop_order that is %s", (_n, value) => {
    expect(hasError(run(base({ route_stops: RS(`R,outbound,${value},A`) })), /stop_order .* must be a whole number/)).toBe(true);
  });

  it("rejects an unknown direction and keeps each direction's sequence separate", () => {
    expect(hasError(run(base({ route_stops: RS("R,sideways,1,A") })), /direction "sideways"/)).toBe(true);
    expect(run(base({ route_stops: RS("R,outbound,1,A", "R,outbound,2,B", "R,inbound,1,C") })).ok).toBe(true);
  });

  it("carries per-route boarding/drop-off overrides, and leaves blanks as 'follow the stop'", () => {
    const rs = csv("route_ref,direction,stop_order,stop_ref,boarding_allowed,dropoff_allowed", "R,outbound,1,A,false,", "R,outbound,2,B,,true");
    const r = run(base({ route_stops: rs }));
    expect(r.payload!.route_stops).toMatchObject([
      { boarding_allowed: false, dropoff_allowed: null },
      { boarding_allowed: null, dropoff_allowed: true },
    ]);
  });
});

describe("fare_rules", () => {
  const F = (...rows: string[]) => csv("route_ref,from_stop_ref,to_stop_ref,passenger_type,amount,effective_from,effective_until", ...rows);
  const fares = (...rows: string[]) => run(base({ fare_rules: F(...rows) }));

  it("accepts stop-to-stop fares for regular and student, and flat fares", () => {
    const r = fares("R,A,C,regular,10,2026-01-01,", "R,A,C,student,8.50,2026-01-01,", "R,,,regular,7,2026-01-01,2026-12-31");
    expect(errors(r)).toEqual([]);
    expect(r.payload!.fares).toHaveLength(3);
    expect(r.payload!.fares[0]).toMatchObject({ route_ref: "R", from_stop_ref: "A", to_stop_ref: "C", amount: 10, effective_until: "" });
    expect(r.payload!.fares[2]).not.toHaveProperty("from_stop_ref");
  });

  it.each([
    ["negative", "-5"], ["a comma decimal", '"12,50"'], ["a currency symbol", "₱12"], ["exponent", "1e3"],
    ["text", "free"], ["three decimals", "12.345"], ["blank", ""], ["thousands separator", '"1,200"'], ["too large", "1000000"],
    ["a trailing dot", "12."], ["a plus sign", "+5"],
  ])("rejects a fare amount that is %s", (_n, amount) => {
    expect(errors(fares(`R,A,C,regular,${amount},2026-01-01,`)).some((e) => e.column === "amount")).toBe(true);
  });

  it("accepts zero but warns", () => {
    const r = fares("R,A,C,regular,0,2026-01-01,");
    expect(errors(r)).toEqual([]);
    expect(warnings(r).some((w) => /fare is 0/.test(w.message))).toBe(true);
  });

  it("rejects unknown passenger types", () => {
    expect(hasError(fares("R,A,C,children,10,2026-01-01,"), /passenger_type "children"/)).toBe(true);
  });

  it.each([
    ["not ISO", "01/02/2026"], ["an impossible date", "2026-02-30"], ["a month 13", "2026-13-01"], ["blank", ""],
  ])("rejects effective_from that is %s", (_n, date) => {
    expect(errors(fares(`R,A,C,regular,10,${date},`)).some((e) => e.column === "effective_from")).toBe(true);
  });

  it("rejects an end date before the start date", () => {
    expect(hasError(fares("R,A,C,regular,10,2026-06-01,2026-05-31"), /before effective_from/)).toBe(true);
  });

  it("needs both stops or neither, different stops, and stops that are on the route", () => {
    expect(hasError(fares("R,A,,regular,10,2026-01-01,"), /both an origin and a destination/)).toBe(true);
    expect(hasError(fares("R,A,A,regular,10,2026-01-01,"), /same/)).toBe(true);
    const extra = base({
      stops: csv("ref,name,latitude,longitude", "A,Alpha Stop,8.95,125.54", "B,Bravo Stop,8.96,125.55", "C,Charlie Stop,8.97,125.56", "D,Delta Stop,8.98,125.57"),
      fare_rules: F("R,A,D,regular,10,2026-01-01,"),
    });
    expect(hasError(run(extra), /to stop is not on this route/)).toBe(true);
  });

  it("rejects overlapping periods within the file, but allows back-to-back periods and other categories", () => {
    expect(hasError(fares("R,A,C,regular,10,2026-01-01,2026-06-30", "R,A,C,regular,11,2026-06-30,"), /overlaps the fare on line 2/, 3)).toBe(true);
    expect(errors(fares("R,A,C,regular,10,2026-01-01,2026-06-30", "R,A,C,regular,11,2026-07-01,", "R,A,C,student,9,2026-01-01,"))).toEqual([]);
    expect(hasError(fares("R,A,C,regular,10,2026-01-01,", "R,A,C,regular,11,2030-01-01,"), /overlaps/)).toBe(true); // open-ended
  });

  it("rejects overlap with an existing fare instead of overwriting it", () => {
    const row = csv("route_id,from_stop_id,to_stop_id,passenger_type,amount,effective_from", `${U1},${U2},${"33333333-3333-4333-8333-333333333333"},regular,12,2026-03-01`);
    const known = existing({
      routes: [dbRoute()],
      stops: [U2, "33333333-3333-4333-8333-333333333333"].map((id) => ({ id, name: id, latitude: 8.9, longitude: 125.5 })),
      routeStops: [U2, "33333333-3333-4333-8333-333333333333"].map((stop_id) => ({ route_id: U1, direction: "outbound", stop_id })),
      fares: [{ route_id: U1, from_stop_id: U2, to_stop_id: "33333333-3333-4333-8333-333333333333", passenger_type: "regular", effective_from: "2026-01-01", effective_until: null }],
    });
    expect(hasError(run({ fare_rules: row }, known), /overlaps an existing fare.*never overwrite/)).toBe(true);
    expect(errors(run({ fare_rules: row.text ? csv("route_id,from_stop_id,to_stop_id,passenger_type,amount,effective_from", `${U1},${U2},33333333-3333-4333-8333-333333333333,student,12,2026-03-01`) : row }, known))).toEqual([]);
  });

  it("does not allow fares on a verified route", () => {
    const row = csv("route_id,passenger_type,amount,effective_from", `${U1},regular,10,2026-01-01`);
    expect(hasError(run({ fare_rules: row }, existing({ routes: [dbRoute(U1, { verification_status: "verified" })] })), /is verified/)).toBe(true);
  });
});

describe("row-level reporting", () => {
  it("reports every problem with its line and column, errors before warnings", () => {
    const r = run({
      stops: csv("ref,name,latitude,longitude", "A,ok,8.95,125.54", "B,bad lat,91,125.5", "C,bad lng,8.9,200", "D,far,1,1"),
    });
    const e = errors(r);
    expect(e.map((i) => [i.file, i.line, i.column])).toEqual([["stops", 3, "latitude"], ["stops", 4, "longitude"]]);
    expect(r.issues.findIndex((i) => i.severity === "warning")).toBeGreaterThan(r.issues.findLastIndex((i) => i.severity === "error"));
    expect(r.preview.stops!.rows.map((x) => x.level)).toEqual(["ok", "error", "error", "warning"]);
  });

  it("truncates long previews", () => {
    const lines = ["ref,name,latitude,longitude"];
    for (let i = 0; i < 80; i++) lines.push(`S${i},Stop ${i},8.95,${125.4 + i / 1000}`);
    const r = run({ stops: csv(...lines) });
    expect(r.preview.stops!.rows).toHaveLength(50);
    expect(r.preview.stops!.truncated).toBe(true);
  });

  it("reports malformed files at file level", () => {
    const r = run({ stops: { name: "s.csv", text: 'ref,name\n"unclosed' } });
    expect(errors(r)[0]).toMatchObject({ file: "stops", line: null, message: "A quoted field is never closed." });
  });
});

describe("value parsers", () => {
  it("parseAmount", () => {
    expect(parseAmount("12.5")).toEqual({ ok: true, value: 12.5 });
    expect(parseAmount("0")).toEqual({ ok: true, value: 0 });
    expect(parseAmount("-0")).toMatchObject({ ok: false });
    expect(parseAmount(" 7 ")).toEqual({ ok: true, value: 7 });
  });
  it("parseIsoDate", () => {
    expect(parseIsoDate("2024-02-29")).toEqual({ ok: true, value: "2024-02-29" });
    expect(parseIsoDate("2025-02-29")).toMatchObject({ ok: false });
  });
  it("parseCoordinate", () => {
    expect(parseCoordinate("-8.5", "latitude")).toEqual({ ok: true, value: -8.5 });
    expect(parseCoordinate("180", "longitude")).toEqual({ ok: true, value: 180 });
    expect(parseCoordinate("180.0001", "longitude")).toMatchObject({ ok: false });
  });
  it("parseBool", () => {
    expect(parseBool("", null)).toEqual({ ok: true, value: null });
    expect(parseBool("YES", null)).toEqual({ ok: true, value: true });
  });
});
