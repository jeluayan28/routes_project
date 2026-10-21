import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  EMPTY_EXISTING,
  IMPORT_KINDS,
  parseImportFiles,
  validateImport,
  type ExistingData,
  type ImportFiles,
} from "@/lib/import/validate";
import { createDb, type Db } from "./harness";

const FIXTURES = path.resolve(import.meta.dirname, "../../dev-fixtures/import");
const files = (): ImportFiles =>
  Object.fromEntries(IMPORT_KINDS.map((k) => [k, { name: `${k}.csv`, text: readFileSync(path.join(FIXTURES, `${k}.csv`), "utf8") }]));

let db: Db;
let admin: string;
beforeAll(async () => {
  db = await createDb();
  admin = await db.createUser(true);
}, 60000);

const q = (sql: string, params: unknown[] = []) => db.pg.query<Record<string, unknown>>(sql, params);

async function loadExisting(): Promise<ExistingData> {
  return {
    ...EMPTY_EXISTING,
    stops: (await q("select id, name, latitude, longitude from public.stops")).rows as ExistingData["stops"],
    routes: (await q("select id, code, name, transport_type, verification_status from public.routes")).rows as ExistingData["routes"],
  };
}

describe("CSV fixture → validator → commit_import", () => {
  it("commits a validated bundle as unverified sample drafts that can never be verified", async () => {
    const report = validateImport(parseImportFiles(files()), await loadExisting());
    expect(report.ok).toBe(true);

    const batch = { id: crypto.randomUUID(), source_description: "Sample fixture (fictional)", files: [] };
    const res = await db.as("authenticated", admin, () =>
      q("select public.commit_import($1::jsonb) r", [JSON.stringify({ batch, ...report.payload })]),
    );
    expect((res.rows[0].r as { counts: object }).counts).toEqual({ stops: 3, routes: 1, route_stops: 5, fares: 2 });

    const route = (await q("select id, status, verification_status, is_sample from public.routes where import_batch_id=$1", [batch.id])).rows[0];
    expect(route).toMatchObject({ status: "draft", verification_status: "unverified", is_sample: true });

    // Directions came through separately, with their own order.
    const inbound = (await q("select s.name from public.route_stops rs join public.stops s on s.id=rs.stop_id where rs.route_id=$1 and rs.direction='inbound' order by rs.stop_order", [route.id])).rows;
    expect(inbound.map((r) => r.name)).toEqual(["[SAMPLE] Stop Three", "[SAMPLE] Stop One"]);

    // Flags and fares survived the round trip.
    const s2 = (await q("select pickup_allowed p, dropoff_allowed d from public.stops where name='[SAMPLE] Stop Two'")).rows[0];
    expect(s2).toEqual({ p: true, d: false });
    expect((await q("select passenger_type from public.fare_rules where route_id=$1 order by passenger_type", [route.id])).rows.map((r) => r.passenger_type)).toEqual(["regular", "student"]);

    // The sample can't be published: even a complete checklist is refused.
    await expect(
      db.as("authenticated", admin, () =>
        q("select public.verify_route($1, '2026-01-01', 'x source', $2::jsonb)", [
          route.id,
          JSON.stringify(Object.fromEntries(["transport_type", "name_direction", "endpoints", "stops", "geometry", "boarding_dropoff", "fares", "passenger_categories"].map((k) => [k, true]))),
        ]),
      ),
    ).rejects.toThrow(/Sample routes cannot be verified/);
  });

  it("the validator now sees the committed data and refuses to import it again", async () => {
    const report = validateImport(parseImportFiles(files()), await loadExisting());
    expect(report.ok).toBe(false);
    expect(report.issues.some((i) => /already exists in the database/.test(i.message))).toBe(true);
    expect(report.issues.some((i) => /Duplicate of existing stop/.test(i.message))).toBe(true);
    expect(report.payload).toBeNull();
  });
});
