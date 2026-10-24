import { beforeAll, describe, expect, it } from "vitest";
import { createDb, line, type Db } from "./harness";

let db: Db;
let admin: string;
let other: string; // signed in, not an administrator
let n = 0;

beforeAll(async () => {
  db = await createDb();
  admin = await db.createUser(true);
  other = await db.createUser(false);
}, 60000);

const asAdmin = <T>(fn: () => Promise<T>) => db.as("authenticated", admin, fn);
const q = (sql: string, params: unknown[] = []) => db.pg.query<Record<string, unknown>>(sql, params);

/** Obviously fictional fixtures. */
async function stop(name = `Test Stop ${++n}`, lat = 0.001, lng = 0.001) {
  const { rows } = await q("insert into public.stops (name, latitude, longitude) values ($1,$2,$3) returning id", [name, lat, lng]);
  return rows[0].id as string;
}

const dir = (direction: "outbound" | "inbound", stops: string[], geometry: unknown = line([0, 0], [0.01, 0.01])) => ({
  direction,
  stops: stops.map((stop_id) => ({ stop_id })),
  geometry,
  geometry_source: "test source",
});

const routeData = (extra: Record<string, unknown> = {}) => ({
  code: `TEST-${++n}`,
  name: `Test Route ${n}`,
  transport_type: "minibus",
  origin_label: "Test Origin",
  destination_label: "Test Destination",
  ...extra,
});

async function saveRoute(data: Record<string, unknown>, id: string | null = null) {
  return asAdmin(async () => {
    const { rows } = await q("select public.save_route($1, $2::jsonb) as id", [id, JSON.stringify(data)]);
    return rows[0].id as string;
  });
}

const ALL_CHECKS = {
  transport_type: true, name_direction: true, endpoints: true, stops: true,
  geometry: true, boarding_dropoff: true, fares: true, passenger_categories: true,
};

async function verify(routeId: string, over: { on?: string; source?: string; checks?: object } = {}) {
  return asAdmin(() =>
    q("select public.verify_route($1, $2::date, $3, $4::jsonb, null) as id", [
      routeId,
      over.on ?? "2026-01-15",
      over.source ?? "Fictional test source",
      JSON.stringify(over.checks ?? ALL_CHECKS),
    ]),
  );
}

async function completeRoute(extra: Record<string, unknown> = {}) {
  const [a, b, c] = [await stop(), await stop(), await stop()];
  const id = await saveRoute({ ...routeData(extra), directions: [dir("outbound", [a, b, c])] });
  return { id, a, b, c };
}

const status = async (id: string) =>
  (await q("select verification_status s, status from public.routes where id=$1", [id])).rows[0] as { s: string; status: string };

describe("who may use the workflow", () => {
  it("rejects signed-in users who are not administrators", async () => {
    await expect(
      db.as("authenticated", other, () => q("select public.save_route(null, $1::jsonb)", [JSON.stringify(routeData())])),
    ).rejects.toThrow(/Administrators only/);
    await expect(
      db.as("authenticated", other, () => q("select public.commit_import($1::jsonb)", ["{}"])),
    ).rejects.toThrow(/Administrators only/);
  });

  it("does not let anonymous visitors call the functions at all", async () => {
    await expect(db.as("anon", null, () => q("select public.save_route(null, '{}'::jsonb)"))).rejects.toThrow(/permission denied/);
    await expect(db.as("anon", null, () => q("select public.is_current_user_admin()"))).rejects.toThrow(/permission denied/);
  });

  it("reports admin status only for the caller", async () => {
    expect((await db.as("authenticated", admin, () => q("select public.is_current_user_admin() v"))).rows[0].v).toBe(true);
    expect((await db.as("authenticated", other, () => q("select public.is_current_user_admin() v"))).rows[0].v).toBe(false);
  });

  it("blocks non-admins from writing routes directly (RLS)", async () => {
    await expect(
      db.as("authenticated", other, () => q("insert into public.routes (name, transport_type) values ('x','minibus')")),
    ).rejects.toThrow(/row-level security/);
  });

  it("keeps import batches and verification records append-only for the API", async () => {
    await expect(asAdmin(() => q("update public.import_batches set notes='x'"))).rejects.toThrow(/permission denied/);
    await expect(asAdmin(() => q("delete from public.route_verifications"))).rejects.toThrow(/permission denied/);
    await expect(db.as("anon", null, () => q("select * from public.route_verifications"))).rejects.toThrow(/permission denied/);
  });
});

describe("save_route", () => {
  it("creates a draft, unverified route with ordered stops and geometry per direction", async () => {
    const [a, b, c, d] = [await stop(), await stop(), await stop(), await stop()];
    const id = await saveRoute({
      ...routeData(),
      directions: [dir("outbound", [a, b, c]), dir("inbound", [c, d, a], line([0.01, 0.01], [0.02, 0], [0, 0]))],
    });
    expect(await status(id)).toEqual({ s: "unverified", status: "draft" });

    const stops = (await q("select direction, stop_order, stop_id from public.route_stops where route_id=$1 order by direction, stop_order", [id])).rows;
    expect(stops.map((r) => `${r.direction}:${r.stop_order}`)).toEqual(["outbound:1", "outbound:2", "outbound:3", "inbound:1", "inbound:2", "inbound:3"]);
    expect(stops.filter((r) => r.direction === "inbound").map((r) => r.stop_id)).toEqual([c, d, a]);
    expect((await q("select count(*)::int n from public.route_shapes where route_id=$1", [id])).rows[0].n).toBe(2);
  });

  it("reorders stops", async () => {
    const [a, b, c] = [await stop(), await stop(), await stop()];
    const id = await saveRoute({ ...routeData(), directions: [dir("outbound", [a, b, c])] });
    await saveRoute({ ...routeData(), directions: [dir("outbound", [c, a, b])] }, id);
    const order = (await q("select stop_id from public.route_stops where route_id=$1 order by stop_order", [id])).rows.map((r) => r.stop_id);
    expect(order).toEqual([c, a, b]);
  });

  it("makes a route one-way by leaving out the inbound direction", async () => {
    const [a, b] = [await stop(), await stop()];
    const id = await saveRoute({ ...routeData(), directions: [dir("outbound", [a, b]), dir("inbound", [b, a])] });
    await saveRoute({ ...routeData(), directions: [dir("outbound", [a, b])] }, id);
    expect((await q("select count(*)::int n from public.route_stops where route_id=$1 and direction='inbound'", [id])).rows[0].n).toBe(0);
    expect((await q("select count(*)::int n from public.route_shapes where route_id=$1 and direction='inbound'", [id])).rows[0].n).toBe(0);
  });

  it("only saves details when directions are not supplied", async () => {
    const { id } = await completeRoute();
    await saveRoute({ ...routeData(), name: "Renamed Route" }, id);
    expect((await q("select count(*)::int n from public.route_stops where route_id=$1", [id])).rows[0].n).toBe(3);
  });

  it("stores a route without geometry (nothing is invented)", async () => {
    const [a, b] = [await stop(), await stop()];
    const id = await saveRoute({ ...routeData(), directions: [dir("outbound", [a, b], null)] });
    expect((await q("select count(*)::int n from public.route_shapes where route_id=$1", [id])).rows[0].n).toBe(0);
  });

  it.each([
    ["a point", { type: "Point", coordinates: [0, 0] }, /LineString or MultiLineString/],
    ["a one-point line", { type: "LineString", coordinates: [[0, 0]] }, /at least two points/],
    ["out-of-range longitude", line([200, 0], [1, 1]), /outside the valid range/],
    ["out-of-range latitude", line([0, 95], [1, 1]), /outside the valid range/],
    ["a short part of a MultiLineString", { type: "MultiLineString", coordinates: [[[0, 0], [1, 1]], [[2, 2]]] }, /at least two points/],
  ])("rejects geometry that is %s, and saves nothing", async (_n, geometry, message) => {
    const [a, b] = [await stop(), await stop()];
    const data = { ...routeData(), directions: [dir("outbound", [a, b], geometry)] };
    await expect(saveRoute(data)).rejects.toThrow(message);
    expect((await q("select count(*)::int n from public.routes where code=$1", [data.code])).rows[0].n).toBe(0);
  });

  it("rejects a stop used twice in one direction and rolls back the route", async () => {
    const a = await stop();
    const data = { ...routeData(), directions: [dir("outbound", [a, a])] };
    await expect(saveRoute(data)).rejects.toThrow(/duplicate key/);
    expect((await q("select count(*)::int n from public.routes where code=$1", [data.code])).rows[0].n).toBe(0);
  });

  it("rejects an unknown stop", async () => {
    await expect(
      saveRoute({ ...routeData(), directions: [dir("outbound", ["00000000-0000-0000-0000-000000000099"])] }),
    ).rejects.toThrow(/foreign key/);
  });

  it("refuses to drop a stop that a fare still uses", async () => {
    const { id, a, b, c } = await completeRoute();
    await q("insert into public.fare_rules (route_id, from_stop_id, to_stop_id, amount, effective_from) values ($1,$2,$3,1,'2026-01-01')", [id, a, c]);
    await expect(saveRoute({ ...routeData(), directions: [dir("outbound", [a, b])] }, id)).rejects.toThrow(/fare rule refers to stop/);
  });

  it("does not let a new route skip draft", async () => {
    const { id } = await completeRoute();
    expect(await status(id)).toEqual({ s: "unverified", status: "draft" });
  });
});

describe("verify_route", () => {
  it("verifies a complete route, records who/when/source, and verifies its parts", async () => {
    const { id, a } = await completeRoute();
    await q("insert into public.fare_rules (route_id, from_stop_id, to_stop_id, amount, effective_from) values ($1,null,null,1,'2026-01-01')", [id]);
    await verify(id, { on: "2026-02-03", source: "Fictional field survey" });

    expect(await status(id)).toEqual({ s: "verified", status: "draft" });
    const v = (await q("select * from public.route_verifications where route_id=$1", [id])).rows[0];
    expect(v).toMatchObject({ source_description: "Fictional field survey", verified_by: admin });
    expect(String(v.verified_on)).toContain("2026");
    expect((await q("select verification_status s from public.stops where id=$1", [a])).rows[0].s).toBe("verified");
    expect((await q("select distinct verification_status s from public.route_shapes where route_id=$1", [id])).rows).toEqual([{ s: "verified" }]);
    expect((await q("select verification_status s from public.fare_rules where route_id=$1", [id])).rows[0].s).toBe("verified");
    const last = (await q("select last_verified_at at from public.routes where id=$1", [id])).rows[0].at as Date;
    expect(last.toISOString()).toBe("2026-02-02T16:00:00.000Z"); // 2026-02-03 00:00 in Asia/Manila
  });

  it("is not public until the route is also active", async () => {
    const { id } = await completeRoute();
    await verify(id);
    expect((await db.as("anon", null, () => q("select id from public.routes where id=$1", [id]))).rows).toHaveLength(0);
    await asAdmin(() => q("update public.routes set status='active' where id=$1", [id]));
    expect((await db.as("anon", null, () => q("select id from public.routes where id=$1", [id]))).rows).toHaveLength(1);
    expect((await db.as("anon", null, () => q("select id from public.route_stops where route_id=$1", [id]))).rows).toHaveLength(3);
  });

  it("never shows an active but unverified route to the public", async () => {
    const { id } = await completeRoute();
    await asAdmin(() => q("update public.routes set status='active' where id=$1", [id]));
    expect((await db.as("anon", null, () => q("select id from public.routes where id=$1", [id]))).rows).toHaveLength(0);
  });

  it.each([
    ["no source", { source: "  " }, /source is required/],
    ["a future date", { on: "2999-01-01" }, /today or earlier/],
    ["an unconfirmed check", { checks: { ...ALL_CHECKS, geometry: false } }, /"geometry" is not confirmed/],
    ["a missing check", { checks: { transport_type: true } }, /is not confirmed/],
  ])("refuses to verify with %s", async (_n, over, message) => {
    const { id } = await completeRoute();
    await expect(verify(id, over)).rejects.toThrow(message);
    expect((await status(id)).s).toBe("unverified");
  });

  it("refuses incomplete content", async () => {
    const [a, b] = [await stop(), await stop()];

    const noLabels = await saveRoute({ ...routeData({ origin_label: "", destination_label: "" }), directions: [dir("outbound", [a, b])] });
    await expect(verify(noLabels)).rejects.toThrow(/Starting and ending points/);

    const oneStop = await saveRoute({ ...routeData(), directions: [dir("outbound", [a])] });
    await expect(verify(oneStop)).rejects.toThrow(/at least two stops/);

    const noShape = await saveRoute({ ...routeData(), directions: [dir("outbound", [a, b], null)] });
    await expect(verify(noShape)).rejects.toThrow(/needs recorded route geometry/);

    const inboundNoShape = await saveRoute({ ...routeData(), directions: [dir("outbound", [a, b]), dir("inbound", [b, a], null)] });
    await expect(verify(inboundNoShape)).rejects.toThrow(/inbound direction has stops but no recorded geometry/);
  });

  it("refuses sample routes and placeholder stops", async () => {
    const { id } = await completeRoute();
    await q("update public.routes set is_sample = true where id=$1", [id]);
    await expect(verify(id)).rejects.toThrow(/Sample routes cannot be verified/);

    const zero = await stop("Placeholder", 0, 0);
    const other2 = await stop();
    const id2 = await saveRoute({ ...routeData(), directions: [dir("outbound", [zero, other2])] });
    await expect(verify(id2)).rejects.toThrow(/sample or placeholder stop/);
  });

  it("makes it impossible, even for the database owner, to mark a sample route verified", async () => {
    const { id } = await completeRoute();
    await q("update public.routes set is_sample = true where id=$1", [id]);
    await expect(
      q("update public.routes set verification_status='verified', last_verified_at=now() where id=$1", [id]),
    ).rejects.toThrow(/routes_sample_never_verified/);
    await expect(
      q("insert into public.stops (name, latitude, longitude, is_sample, verification_status, last_verified_at) values ('s',1,1,true,'verified',now())"),
    ).rejects.toThrow(/stops_sample_never_verified/);
  });

  it("is atomic: a failed verification changes nothing", async () => {
    const { id, a } = await completeRoute();
    await expect(verify(id, { checks: { ...ALL_CHECKS, fares: false } })).rejects.toThrow();
    expect((await q("select verification_status s from public.stops where id=$1", [a])).rows[0].s).toBe("unverified");
    expect((await q("select count(*)::int n from public.route_verifications where route_id=$1", [id])).rows[0].n).toBe(0);
  });
});

describe("verification cannot be bypassed through the API", () => {
  it("blocks setting verified directly, on insert or update", async () => {
    const { id, a } = await completeRoute();
    await expect(asAdmin(() => q("update public.routes set verification_status='verified', last_verified_at=now() where id=$1", [id]))).rejects.toThrow(/verify_route/);
    await expect(asAdmin(() => q("insert into public.routes (name, transport_type, verification_status, last_verified_at) values ('x','minibus','verified',now())"))).rejects.toThrow(/verify_route/);
    await expect(asAdmin(() => q("update public.stops set verification_status='verified', last_verified_at=now() where id=$1", [a]))).rejects.toThrow(/verify_route/);
    await expect(asAdmin(() => q("insert into public.stops (name, latitude, longitude, verification_status, last_verified_at) values ('x',1,1,'verified',now())"))).rejects.toThrow(/verify_route/);
  });

  it("forces new and edited fares to unverified", async () => {
    const { id } = await completeRoute();
    await asAdmin(() => q("insert into public.fare_rules (route_id, amount, effective_from, verification_status, verified_at) values ($1, 1, '2026-01-01', 'verified', now())", [id]));
    expect((await q("select verification_status s, verified_at v from public.fare_rules where route_id=$1", [id])).rows[0]).toEqual({ s: "unverified", v: null });
    await expect(asAdmin(() => q("update public.fare_rules set verification_status='verified', verified_at=now() where route_id=$1", [id]))).rejects.toThrow(/verify_route/);
  });

  it("blocks verifying geometry directly and keeps new geometry unverified", async () => {
    const { id } = await completeRoute();
    await expect(
      asAdmin(() => q("update public.route_shapes set verification_status='verified', last_verified_at=now() where route_id=$1", [id])),
    ).rejects.toThrow(/verify_route/);
    expect((await q("select distinct verification_status s from public.route_shapes where route_id=$1", [id])).rows).toEqual([{ s: "unverified" }]);
  });
});

describe("edits send verified data back for review", () => {
  async function verified() {
    const r = await completeRoute();
    await q("insert into public.fare_rules (route_id, amount, effective_from) values ($1, 1, '2026-01-01')", [r.id]);
    await verify(r.id);
    expect((await status(r.id)).s).toBe("verified");
    return r;
  }

  it("keeps verification when a save changes nothing", async () => {
    const { id, a, b, c } = await verified();
    const same = { ...routeData({ code: (await q("select code from public.routes where id=$1", [id])).rows[0].code }), name: (await q("select name from public.routes where id=$1", [id])).rows[0].name };
    await saveRoute({ ...same, directions: [dir("outbound", [a, b, c])] }, id);
    expect((await status(id)).s).toBe("verified");
  });

  it("unverifies when the stop order changes", async () => {
    const { id, a, b, c } = await verified();
    const row = (await q("select code, name from public.routes where id=$1", [id])).rows[0];
    await saveRoute({ ...routeData(row), directions: [dir("outbound", [b, a, c])] }, id);
    expect((await status(id)).s).toBe("unverified");
  });

  it("unverifies when the geometry changes", async () => {
    const { id, a, b, c } = await verified();
    const row = (await q("select code, name from public.routes where id=$1", [id])).rows[0];
    await saveRoute({ ...routeData(row), directions: [dir("outbound", [a, b, c], line([0, 0], [0.5, 0.5]))] }, id);
    expect((await status(id)).s).toBe("unverified");
  });

  it("unverifies when the name or endpoints change", async () => {
    const { id } = await verified();
    await asAdmin(() => q("update public.routes set name = 'Changed' where id=$1", [id]));
    expect((await status(id)).s).toBe("unverified");
  });

  it("does not unverify for a status change (activate/deactivate)", async () => {
    const { id } = await verified();
    await asAdmin(() => q("update public.routes set status='active' where id=$1", [id]));
    await asAdmin(() => q("update public.routes set status='inactive' where id=$1", [id]));
    expect((await status(id)).s).toBe("verified");
  });

  it("unverifies every route using a stop whose coordinates change", async () => {
    const { id, a } = await verified();
    await asAdmin(() => q("update public.stops set latitude = 0.5 where id=$1", [a]));
    expect((await status(id)).s).toBe("unverified");
    expect((await q("select verification_status s from public.stops where id=$1", [a])).rows[0].s).toBe("unverified");
  });

  it("unverifies when a stop is boarding-restricted", async () => {
    const { id, a, b, c } = await verified();
    const row = (await q("select code, name from public.routes where id=$1", [id])).rows[0];
    await saveRoute({ ...routeData(row), directions: [{ direction: "outbound", stops: [{ stop_id: a, boarding_allowed: false }, { stop_id: b }, { stop_id: c }], geometry: line([0, 0], [0.01, 0.01]) }] }, id);
    expect((await status(id)).s).toBe("unverified");
  });
});

describe("fare rules", () => {
  it("supports origin/destination fares with categories and effective dates", async () => {
    const { id, a, c } = await completeRoute();
    await asAdmin(async () => {
      await q("insert into public.fare_rules (route_id, from_stop_id, to_stop_id, passenger_type, amount, effective_from, effective_until) values ($1,$2,$3,'regular',12.50,'2026-01-01','2026-06-30')", [id, a, c]);
      await q("insert into public.fare_rules (route_id, from_stop_id, to_stop_id, passenger_type, amount, effective_from) values ($1,$2,$3,'student',10,'2026-01-01')", [id, a, c]);
      await q("insert into public.fare_rules (route_id, from_stop_id, to_stop_id, passenger_type, amount, effective_from) values ($1,$2,$3,'regular',13,'2026-07-01')", [id, a, c]);
    });
    expect((await q("select count(*)::int n from public.fare_rules where route_id=$1", [id])).rows[0].n).toBe(3);
  });

  it("rejects negative amounts, overlapping periods, and stops not on the route", async () => {
    const { id, a, c } = await completeRoute();
    const off = await stop();
    const ins = (from: string | null, to: string | null, amount: number, eff = "2026-01-01") =>
      asAdmin(() => q("insert into public.fare_rules (route_id, from_stop_id, to_stop_id, amount, effective_from) values ($1,$2,$3,$4,$5)", [id, from, to, amount, eff]));
    await expect(ins(a, c, -1)).rejects.toThrow(/fare_rules_amount_not_negative/);
    await ins(a, c, 10);
    await expect(ins(a, c, 11, "2026-03-01")).rejects.toThrow(/fare_rules_no_overlap/);
    await expect(ins(a, off, 10)).rejects.toThrow(/is not on route/);
    await expect(ins(a, null, 10)).rejects.toThrow(/fare_rules_stops_paired/);
  });
});

describe("commit_import", () => {
  const batch = (over: Record<string, unknown> = {}) => ({
    id: crypto.randomUUID(),
    source_description: "Fictional import source",
    files: [{ kind: "routes", name: "routes.csv", sha256: "abc", rows: 1 }],
    ...over,
  });
  const payload = (over: Record<string, unknown> = {}) => ({
    batch: batch(),
    stops: [
      { ref: "s1", name: "Import Stop One", latitude: 0.001, longitude: 0.001, pickup_allowed: true, dropoff_allowed: true },
      { ref: "s2", name: "Import Stop Two", latitude: 0.002, longitude: 0.002, is_sample: true },
    ],
    routes: [{ ref: "r1", code: `IMP-${++n}`, name: "Import Route", transport_type: "multicab", origin_label: "A", destination_label: "B", is_sample: true }],
    route_stops: [
      { route_ref: "r1", stop_ref: "s1", direction: "outbound", stop_order: 1 },
      { route_ref: "r1", stop_ref: "s2", direction: "outbound", stop_order: 2, boarding_allowed: false },
    ],
    fares: [{ route_ref: "r1", from_stop_ref: "s1", to_stop_ref: "s2", passenger_type: "regular", amount: 9.5, effective_from: "2026-01-01", source_description: "Fictional fare source" }],
    ...over,
  });
  const commit = (p: unknown) => asAdmin(() => q("select public.commit_import($1::jsonb) as r", [JSON.stringify(p)]));

  it("creates everything as unverified drafts, tagged with the batch and the administrator", async () => {
    const p = payload();
    const res = (await commit(p)).rows[0].r as { batch_id: string; counts: Record<string, number> };
    expect(res.counts).toEqual({ stops: 2, routes: 1, route_stops: 2, fares: 1 });

    const b = (await q("select * from public.import_batches where id=$1", [res.batch_id])).rows[0];
    expect(b).toMatchObject({ imported_by: admin, source_description: "Fictional import source" });

    const route = (await q("select status, verification_status, is_sample from public.routes where import_batch_id=$1", [res.batch_id])).rows[0];
    expect(route).toEqual({ status: "draft", verification_status: "unverified", is_sample: true });
    expect((await q("select count(*)::int n from public.stops where import_batch_id=$1 and verification_status='unverified'", [res.batch_id])).rows[0].n).toBe(2);
    expect((await q("select verification_status s from public.fare_rules where import_batch_id=$1", [res.batch_id])).rows[0].s).toBe("unverified");
    expect((await q("select count(*)::int n from public.route_stops rs join public.routes r on r.id=rs.route_id where r.import_batch_id=$1", [res.batch_id])).rows[0].n).toBe(2);
  });

  it("is all-or-nothing: a failure part-way leaves no rows and no batch", async () => {
    const p = payload({
      route_stops: [
        { route_ref: "r1", stop_ref: "s1", direction: "outbound", stop_order: 1 },
        { route_ref: "r1", stop_ref: "s2", direction: "outbound", stop_order: 1 }, // duplicate order
      ],
    });
    const before = (await q("select (select count(*) from public.stops)::int s, (select count(*) from public.routes)::int r, (select count(*) from public.import_batches)::int b")).rows[0];
    await expect(commit(p)).rejects.toThrow(/route_stops_unique_order|duplicate key/);
    const after = (await q("select (select count(*) from public.stops)::int s, (select count(*) from public.routes)::int r, (select count(*) from public.import_batches)::int b")).rows[0];
    expect(after).toEqual(before);
  });

  it("rejects replaying the same batch id", async () => {
    const b = batch();
    await commit(payload({ batch: b }));
    await expect(commit(payload({ batch: b, routes: [{ ref: "r1", code: `IMP-${++n}`, name: "Again", transport_type: "minibus" }] }))).rejects.toThrow(/import_batches_pkey|duplicate key/);
  });

  it("will not touch a verified existing route", async () => {
    const { id, a } = await completeRoute();
    await verify(id);
    const extra = await stop();
    await expect(
      commit({ batch: batch(), route_stops: [{ route_id: id, stop_id: extra, direction: "inbound", stop_order: 1 }] }),
    ).rejects.toThrow(/is verified/);
    expect((await status(id)).s).toBe("verified");
    void a;
  });

  it("can add stops to an existing unverified route by UUID without replacing anything", async () => {
    const [a, b] = [await stop(), await stop()];
    const id = await saveRoute({ ...routeData(), directions: [dir("outbound", [a, b])] });
    const extra = await stop();
    await commit({ batch: batch(), route_stops: [{ route_id: id, stop_id: extra, direction: "inbound", stop_order: 1 }] });
    expect((await q("select count(*)::int n from public.route_stops where route_id=$1", [id])).rows[0].n).toBe(3);
    // Re-using an occupied position is rejected instead of overwriting.
    await expect(
      commit({ batch: batch(), route_stops: [{ route_id: id, stop_id: await stop(), direction: "outbound", stop_order: 1 }] }),
    ).rejects.toThrow(/duplicate key|route_stops_unique_order/);
    expect((await q("select stop_id s from public.route_stops where route_id=$1 and direction='outbound' and stop_order=1", [id])).rows[0].s).toBe(a);
  });

  it("rejects a row that does not resolve to a route or stop", async () => {
    await expect(commit({ batch: batch(), route_stops: [{ route_ref: "nope", stop_ref: "nope", direction: "outbound", stop_order: 1 }] })).rejects.toThrow(/does not resolve/);
  });

  it("requires a declared source", async () => {
    await expect(commit(payload({ batch: batch({ source_description: " " }) }))).rejects.toThrow(/import_batches_source_not_blank/);
  });
});
