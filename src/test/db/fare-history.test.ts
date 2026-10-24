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
const asOther = <T>(fn: () => Promise<T>) => db.as("authenticated", other, fn);
const asAnon = <T>(fn: () => Promise<T>) => db.as("anon", null, fn);
const q = (sql: string, params: unknown[] = []) => db.pg.query<Record<string, unknown>>(sql, params);

const ALL_CHECKS = {
  transport_type: true, name_direction: true, endpoints: true, stops: true,
  geometry: true, boarding_dropoff: true, fares: true, passenger_categories: true,
};

/** A fictional route with three stops. Obviously not real data. */
async function route() {
  const stops: string[] = [];
  for (let i = 0; i < 3; i++) {
    const { rows } = await q("insert into public.stops (name, latitude, longitude) values ($1, 0.001, 0.001) returning id", [`Fare Test Stop ${++n}`]);
    stops.push(rows[0].id as string);
  }
  const data = {
    code: `FT-${++n}`, name: `Fare Test Route ${n}`, transport_type: "minibus", origin_label: "A", destination_label: "B",
    directions: [{ direction: "outbound", stops: stops.map((stop_id) => ({ stop_id })), geometry: line([0, 0], [0.01, 0.01]), geometry_source: "test" }],
  };
  const id = await asAdmin(async () => (await q("select public.save_route(null, $1::jsonb) as id", [JSON.stringify(data)])).rows[0].id as string);
  return { id, stops };
}

const addFare = (routeId: string, amount: number, from: string, until: string | null = null, category = "regular") =>
  asAdmin(async () =>
    (await q(
      "insert into public.fare_rules (route_id, passenger_type, amount, effective_from, effective_until, source_description) values ($1,$2,$3,$4,$5,'Test source') returning id",
      [routeId, category, amount, from, until],
    )).rows[0].id as string,
  );

const verify = (routeId: string, on = "2026-01-15") =>
  asAdmin(() => q("select public.verify_route($1, $2::date, 'Fictional test source', $3::jsonb, null)", [routeId, on, JSON.stringify(ALL_CHECKS)]));

const rules = async (routeId: string) =>
  (await q(
    "select id, amount::text as amount, effective_from::text as f, effective_until::text as u, verification_status as s, verified_at is not null as stamped from public.fare_rules where route_id=$1 order by effective_from",
    [routeId],
  )).rows;

describe("fare history", () => {
  it("stores amounts with fixed precision", async () => {
    const { id } = await route();
    await addFare(id, 12.5, "2026-01-01");
    expect((await rules(id))[0].amount).toBe("12.50");
  });

  it("change_fare ends the old rule the day before and adds an unverified one, keeping both", async () => {
    const { id } = await route();
    const old = await addFare(id, 12, "2026-01-01");
    await verify(id);
    const created = await asAdmin(async () => (await q("select public.change_fare($1, 13, '2026-07-01', 'New fare table') as id", [old])).rows[0].id as string);

    const all = await rules(id);
    expect(all).toHaveLength(2);
    expect(all[0]).toMatchObject({ id: old, amount: "12.00", f: "2026-01-01", u: "2026-06-30", s: "verified", stamped: true });
    expect(all[1]).toMatchObject({ id: created, amount: "13.00", f: "2026-07-01", u: null, s: "unverified", stamped: false });
  });

  it("change_fare keeps the original end date of the rule it replaces", async () => {
    const { id } = await route();
    const old = await addFare(id, 12, "2026-01-01", "2026-12-31");
    await asAdmin(() => q("select public.change_fare($1, 14, '2026-04-01', 'Source')", [old]));
    expect((await rules(id)).map((r) => [r.f, r.u])).toEqual([["2026-01-01", "2026-03-31"], ["2026-04-01", "2026-12-31"]]);
  });

  it("rejects a bad price change", async () => {
    const { id } = await route();
    const old = await addFare(id, 12, "2026-01-01", "2026-03-31");
    const change = (amount: number, from: string, source = "Source") => asAdmin(() => q("select public.change_fare($1, $2, $3::date, $4)", [old, amount, from, source]));
    await expect(change(-1, "2026-02-01")).rejects.toThrow(/at most two decimals/);
    await expect(change(12.345, "2026-02-01")).rejects.toThrow(/at most two decimals/);
    await expect(change(13, "2026-01-01")).rejects.toThrow(/must start after/);
    await expect(change(13, "2026-06-01")).rejects.toThrow(/already ended/);
    await expect(change(13, "2026-02-01", " ")).rejects.toThrow(/source/);
    expect(await rules(id)).toHaveLength(1);
  });

  it("does not let API callers edit or delete a verified fare", async () => {
    const { id } = await route();
    const fare = await addFare(id, 12, "2026-01-01");
    await verify(id);
    await expect(asAdmin(() => q("update public.fare_rules set amount = 99 where id=$1", [fare]))).rejects.toThrow(/kept as history/);
    await expect(asAdmin(() => q("update public.fare_rules set effective_until = '2026-02-01' where id=$1", [fare]))).rejects.toThrow(/kept as history/);
    await expect(asAdmin(() => q("delete from public.fare_rules where id=$1", [fare]))).rejects.toThrow(/kept as history/);
    expect((await rules(id))[0]).toMatchObject({ amount: "12.00", s: "verified" });
  });

  it("still lets an unverified fare be edited and deleted", async () => {
    const { id } = await route();
    const fare = await addFare(id, 12, "2026-01-01");
    await asAdmin(() => q("update public.fare_rules set amount = 15 where id=$1", [fare]));
    expect((await rules(id))[0].amount).toBe("15.00");
    await asAdmin(() => q("delete from public.fare_rules where id=$1", [fare]));
    expect(await rules(id)).toHaveLength(0);
  });

  it("end_fare stops a verified fare without un-verifying it", async () => {
    const { id } = await route();
    const fare = await addFare(id, 12, "2026-01-01");
    await verify(id);
    await asAdmin(() => q("select public.end_fare($1, '2026-08-31')", [fare]));
    expect((await rules(id))[0]).toMatchObject({ u: "2026-08-31", s: "verified", stamped: true });
    await expect(asAdmin(() => q("select public.end_fare($1, '2026-09-30')", [fare]))).rejects.toThrow(/earlier/);
    await expect(asAdmin(() => q("select public.end_fare($1, '2025-12-31')", [fare]))).rejects.toThrow(/before the fare starts/);
  });

  it("re-verifying a route does not re-stamp fares that were already verified", async () => {
    const { id } = await route();
    const old = await addFare(id, 12, "2026-01-01");
    await verify(id, "2026-01-15");
    const stamp = async () => (await q("select verified_at::text v from public.fare_rules where id=$1", [old])).rows[0].v;
    const before = await stamp();
    await asAdmin(() => q("select public.change_fare($1, 13, '2026-07-01', 'Source')", [old]));
    await verify(id, "2026-06-20");
    expect(await stamp()).toBe(before);
    expect((await rules(id)).map((r) => r.s)).toEqual(["verified", "verified"]);
  });

  it("the public sees only verified fares", async () => {
    const { id } = await route();
    const old = await addFare(id, 12, "2026-01-01");
    await verify(id);
    await asAdmin(() => q("update public.routes set status = 'active' where id=$1", [id]));
    await asAdmin(() => q("select public.change_fare($1, 13, '2026-07-01', 'Source')", [old]));
    const seen = await asAnon(async () => (await q("select amount::text a from public.fare_rules where route_id=$1", [id])).rows);
    expect(seen.map((r) => r.a)).toEqual(["12.00"]);
  });
});

describe("who may change fares", () => {
  it("rejects non-administrators calling the functions directly", async () => {
    const { id } = await route();
    const fare = await addFare(id, 12, "2026-01-01");
    await expect(asOther(() => q("select public.change_fare($1, 13, '2026-07-01', 'Source')", [fare]))).rejects.toThrow(/Administrators only/);
    await expect(asOther(() => q("select public.end_fare($1, '2026-07-01')", [fare]))).rejects.toThrow(/Administrators only/);
    await expect(asAnon(() => q("select public.change_fare($1, 13, '2026-07-01', 'Source')", [fare]))).rejects.toThrow(/permission denied/);
  });

  it("rejects non-administrators writing fare rules through the table", async () => {
    const { id } = await route();
    const fare = await addFare(id, 12, "2026-01-01");
    await expect(asOther(() => q("insert into public.fare_rules (route_id, amount, effective_from) values ($1, 1, '2026-01-01')", [id]))).rejects.toThrow();
    // RLS hides the row from them, so an update or delete touches nothing.
    await asOther(() => q("update public.fare_rules set amount = 1 where id=$1", [fare]));
    await asOther(() => q("delete from public.fare_rules where id=$1", [fare]));
    expect((await rules(id))[0].amount).toBe("12.00");
  });

  it("rejects overlapping fares for the same slot", async () => {
    const { id } = await route();
    await addFare(id, 12, "2026-01-01", "2026-06-30");
    await expect(addFare(id, 13, "2026-06-30")).rejects.toThrow();
  });
});
