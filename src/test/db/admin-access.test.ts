import { beforeAll, describe, expect, it } from "vitest";
import { createDb, line, type Db } from "./harness";

/**
 * Authorization at the database, which is what protects the data even if the app
 * (or its Server Actions) were bypassed entirely: these run SQL directly as the
 * `anon` and `authenticated` API roles, exactly as a PostgREST caller would.
 */

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
/** Denied means the database either refuses outright or (row-level security) shows and changes nothing. */
const denied = async (run: () => Promise<{ rows: unknown[]; affectedRows?: number }>) => {
  try {
    const r = await run();
    return r.rows.length === 0 && (r.affectedRows ?? 0) === 0;
  } catch {
    return true;
  }
};
const count = async (sql: string, params: unknown[] = []) => Number((await q(`select count(*)::int c from (${sql}) t`, params)).rows[0].c);

const ALL_CHECKS = {
  transport_type: true, name_direction: true, endpoints: true, stops: true,
  geometry: true, boarding_dropoff: true, fares: true, passenger_categories: true,
};

async function stop() {
  const { rows } = await q("insert into public.stops (name, latitude, longitude) values ($1, 0.001, 0.001) returning id", [`Access Test Stop ${++n}`]);
  return rows[0].id as string;
}

async function route() {
  const stops = [await stop(), await stop()];
  const data = {
    code: `AT-${++n}`, name: `Access Test Route ${n}`, transport_type: "minibus", origin_label: "A", destination_label: "B",
    directions: [{ direction: "outbound", stops: stops.map((stop_id) => ({ stop_id })), geometry: line([0, 0], [0.01, 0.01]), geometry_source: "test" }],
  };
  const id = await asAdmin(async () => (await q("select public.save_route(null, $1::jsonb) as id", [JSON.stringify(data)])).rows[0].id as string);
  return { id, stops };
}

const report = (routeId: string | null = null, contact: string | null = "secret@example.test") =>
  q("insert into public.route_reports (route_id, report_type, description, reporter_contact) values ($1, $3, 'The fare shown is wrong for this route.', $2) returning id", [routeId, contact, routeId ? "incorrect_fare" : "other"]).then((r) => r.rows[0].id as string);

describe("who is an administrator", () => {
  it("is decided by the allow-list, not by the caller", async () => {
    expect((await asAdmin(() => q("select public.is_current_user_admin() a"))).rows[0].a).toBe(true);
    expect((await asOther(() => q("select public.is_current_user_admin() a"))).rows[0].a).toBe(false);
    // Visitors are not even allowed to ask.
    await expect(asAnon(() => q("select public.is_current_user_admin() a"))).rejects.toThrow(/permission denied/);
  });

  it("cannot be changed through the API: no one can add themselves to the allow-list", async () => {
    await expect(asOther(() => q("insert into private.admin_users (user_id) values ($1)", [other]))).rejects.toThrow();
    await expect(asAnon(() => q("insert into private.admin_users (user_id) values ($1)", [other]))).rejects.toThrow();
    await expect(asAdmin(() => q("insert into private.admin_users (user_id) values ($1)", [other]))).rejects.toThrow();
    expect((await asOther(() => q("select public.is_current_user_admin() a"))).rows[0].a).toBe(false);
  });

  it("ignores a role claim in the token: only the user id counts", async () => {
    await db.pg.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: other, role: "authenticated", app_metadata: { role: "admin" }, user_metadata: { is_admin: true } })]);
    await db.pg.exec("set role authenticated");
    try {
      expect((await q("select public.is_current_user_admin() a")).rows[0].a).toBe(false);
    } finally {
      await db.pg.exec("reset role");
      await db.pg.query("select set_config('request.jwt.claims', '', false)");
    }
  });
});

describe("transport data", () => {
  it("cannot be written by non-administrators or visitors", async () => {
    const { id, stops } = await route();
    for (const as of [asOther, asAnon]) {
      await expect(as(() => q("insert into public.routes (name, transport_type) values ('x', 'minibus')"))).rejects.toThrow();
      await expect(as(() => q("insert into public.stops (name, latitude, longitude) values ('x', 1, 1)"))).rejects.toThrow();
      await expect(as(() => q("insert into public.fare_rules (route_id, amount, effective_from) values ($1, 1, '2026-01-01')", [id]))).rejects.toThrow();
      await expect(as(() => q("insert into public.landmarks (name, category, latitude, longitude) values ('x', 'x', 1, 1)"))).rejects.toThrow();
    }
    // Existing rows are invisible to them, so changes and deletes affect nothing.
    expect(await denied(() => asOther(() => q("update public.routes set name = 'hacked' where id=$1", [id])))).toBe(true);
    expect(await denied(() => asOther(() => q("update public.stops set name = 'hacked' where id=$1", [stops[0]])))).toBe(true);
    expect(await denied(() => asOther(() => q("delete from public.routes where id=$1", [id])))).toBe(true);
    expect(await denied(() => asAnon(() => q("delete from public.stops where id=$1", [stops[0]])))).toBe(true);
    expect((await q("select name from public.routes where id=$1", [id])).rows[0].name).toMatch(/^Access Test Route/);
    expect((await q("select name from public.stops where id=$1", [stops[0]])).rows[0].name).toMatch(/^Access Test Stop/);
  });

  it("cannot be created or approved through the admin functions", async () => {
    const { id } = await route();
    const checks = JSON.stringify(ALL_CHECKS);
    for (const as of [asOther, asAnon]) {
      await expect(as(() => q("select public.save_route(null, '{}'::jsonb)"))).rejects.toThrow();
      await expect(as(() => q("select public.verify_route($1, '2026-01-15', 'src', $2::jsonb, null)", [id, checks]))).rejects.toThrow();
      await expect(as(() => q("select public.commit_import('{}'::jsonb)"))).rejects.toThrow();
    }
  });

  it("only shows the public verified, active routes", async () => {
    const { id } = await route();
    expect(await asAnon(() => count("select 1 from public.routes where id=$1", [id]))).toBe(0);
    expect(await asOther(() => count("select 1 from public.routes where id=$1", [id]))).toBe(0);
    expect(await asAdmin(() => count("select 1 from public.routes where id=$1", [id]))).toBe(1);
  });
});

describe("public reports", () => {
  it("can be submitted by visitors, who cannot choose the workflow state", async () => {
    // Visitors are granted only the content columns. Naming the status (or id) is refused outright...
    await expect(asAnon(() => q("insert into public.route_reports (report_type, description, status) values ('other', 'Something is wrong here, please check.', 'resolved')"))).rejects.toThrow(/permission denied/);
    // ...and a plain submission is accepted (no RETURNING: they cannot read the row back) and starts as pending.
    await asAnon(() => q("insert into public.route_reports (report_type, description) values ('other', 'Visitor submission for the access test.')"));
    expect((await q("select status from public.route_reports where description = 'Visitor submission for the access test.'")).rows[0].status).toBe("new");
    // The description rules still apply.
    await expect(asAnon(() => q("insert into public.route_reports (report_type, description) values ('other', 'short')"))).rejects.toThrow();
  });

  it("cannot be read, changed or deleted by visitors or non-administrators", async () => {
    const id = await report();
    expect(await denied(() => asAnon(() => q("select id from public.route_reports")))).toBe(true);
    expect(await denied(() => asOther(() => q("select id from public.route_reports")))).toBe(true);
    expect(await denied(() => asAnon(() => q("update public.route_reports set status='resolved' where id=$1", [id])))).toBe(true);
    expect(await denied(() => asOther(() => q("update public.route_reports set status='resolved' where id=$1", [id])))).toBe(true);
    expect(await denied(() => asOther(() => q("delete from public.route_reports where id=$1", [id])))).toBe(true);
    expect(await denied(() => asAnon(() => q("delete from public.route_reports where id=$1", [id])))).toBe(true);
    expect((await q("select status from public.route_reports where id=$1", [id])).rows[0].status).toBe("new");
  });

  it("do not leak the reporter's contact details to anyone but an administrator", async () => {
    await report(null, "reporter-private@example.test");
    expect(await denied(() => asAnon(() => q("select reporter_contact from public.route_reports")))).toBe(true);
    expect(await denied(() => asOther(() => q("select reporter_contact from public.route_reports")))).toBe(true);
    const rows = await asAdmin(async () => (await q("select reporter_contact from public.route_reports where reporter_contact like 'reporter-private%'")).rows);
    expect(rows).toHaveLength(1);
  });

  it("can be triaged by an administrator, only through set_report_status", async () => {
    const id = await report();
    const set = (status: string, note: string | null = null) => asAdmin(() => q("select public.set_report_status($1, $2, $3)", [id, status, note]));
    await set("reviewing");
    await set("resolved", "Fixed the stop name");
    expect((await q("select status, resolution_note n, resolved_by b, resolved_at is not null t from public.route_reports where id=$1", [id])).rows[0]).toEqual({ status: "resolved", n: "Fixed the stop name", b: admin, t: true });
    await set("new");
    expect((await q("select status, resolved_by b, resolved_at t from public.route_reports where id=$1", [id])).rows[0]).toEqual({ status: "new", b: null, t: null });
    // Direct updates are not allowed at all, so a resolution can never go unrecorded.
    await expect(asAdmin(() => q("update public.route_reports set status='resolved' where id=$1", [id]))).rejects.toThrow(/permission denied/);
    await expect(asAdmin(() => q("update public.route_reports set description='rewritten' where id=$1", [id]))).rejects.toThrow(/permission denied/);
  });
});

describe("audit log", () => {
  it("cannot be read, written or changed by visitors or non-administrators", async () => {
    for (const as of [asAnon, asOther]) {
      expect(await denied(() => as(() => q("select * from public.audit_logs")))).toBe(true);
      await expect(as(() => q("insert into public.audit_logs (entity_type, action) values ('routes', 'insert')"))).rejects.toThrow();
    }
  });

  it("is append-only, even for administrators", async () => {
    await route();
    await expect(asAdmin(() => q("update public.audit_logs set entity_type='x'"))).rejects.toThrow();
    await expect(asAdmin(() => q("delete from public.audit_logs"))).rejects.toThrow();
    await expect(asAdmin(() => q("insert into public.audit_logs (entity_type, action) values ('routes', 'insert')"))).rejects.toThrow();
    // The trigger still refuses when permission checks are bypassed.
    await expect(q("update public.audit_logs set entity_type='x'")).rejects.toThrow(/append-only/);
    await expect(q("delete from public.audit_logs")).rejects.toThrow(/append-only/);
  });

  it("records who triaged a report and what the status was before, without the reporter's contact", async () => {
    const id = await report(null, "audit-secret@example.test");
    await asAdmin(() => q("select public.set_report_status($1, 'resolved', 'Checked and fixed')", [id]));
    const log = (await q("select admin_id, action, changes, previous from public.audit_logs where entity_type='route_reports' and entity_id=$1", [id])).rows;
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ admin_id: admin, action: "update", previous: { status: "new" } });
    expect((log[0].changes as Record<string, unknown>).status).toBe("resolved");
    expect(JSON.stringify(log)).not.toContain("audit-secret");
  });

  it("records route changes, deactivation and approval with the administrator's id", async () => {
    const { id } = await route();
    await asAdmin(() => q("select public.verify_route($1, '2026-01-15', 'Fictional source', $2::jsonb, null)", [id, JSON.stringify(ALL_CHECKS)]));
    await asAdmin(() => q("update public.routes set status='active' where id=$1", [id]));
    await asAdmin(() => q("update public.routes set status='inactive' where id=$1", [id]));

    const routes = (await q("select admin_id, action, changes ->> 'status' as status, previous ->> 'status' as was from public.audit_logs where entity_type='routes' and entity_id=$1 order by id", [id])).rows;
    expect(routes.every((r) => r.admin_id === admin)).toBe(true);
    expect(routes[0]).toMatchObject({ action: "insert" });
    expect(routes[routes.length - 1]).toMatchObject({ action: "update", status: "inactive", was: "active" });

    const approvals = (await q("select admin_id from public.audit_logs where entity_type='route_verifications' and changes ->> 'route_id' = $1", [id])).rows;
    expect(approvals).toEqual([{ admin_id: admin }]);
  });

  it("records fare changes with the old values", async () => {
    const { id } = await route();
    const fare = await asAdmin(async () => (await q("insert into public.fare_rules (route_id, amount, effective_from) values ($1, 12, '2026-01-01') returning id", [id])).rows[0].id as string);
    await asAdmin(() => q("update public.fare_rules set amount = 13 where id=$1", [fare]));
    const last = (await q("select admin_id, previous, changes from public.audit_logs where entity_type='fare_rules' and entity_id=$1 order by id desc limit 1", [fare])).rows[0];
    expect(last.admin_id).toBe(admin);
    expect(last.previous).toEqual({ amount: 12 });
    expect((last.changes as Record<string, unknown>).amount).toBe(13);
  });

  it("can be read by administrators", async () => {
    expect(await asAdmin(() => count("select 1 from public.audit_logs"))).toBeGreaterThan(0);
  });
});
