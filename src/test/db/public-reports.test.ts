import { beforeAll, describe, expect, it } from "vitest";
import { createDb, line, type Db } from "./harness";

/**
 * The public report path, exercised as the `anon` role against the real
 * migrations: what a visitor may submit, what is refused, how the rate limit
 * works, and that a report can never change official data.
 */

let db: Db;
let admin: string;
let n = 0;
let live: { id: string; stops: string[] }; // active and verified: public
let draft: { id: string; stops: string[] }; // never verified: not public

beforeAll(async () => {
  db = await createDb();
  admin = await db.createUser(true);
  live = await route(true);
  draft = await route(false);
}, 90000);

const q = (sql: string, params: unknown[] = []) => db.pg.query<Record<string, unknown>>(sql, params);
const asAdmin = <T>(fn: () => Promise<T>) => db.as("authenticated", admin, fn);
const asAnon = <T>(fn: () => Promise<T>) => db.as("anon", null, fn);

/** A visitor at a given client address (what the Supabase edge puts in cf-connecting-ip). */
async function asVisitor<T>(ip: string, fn: () => Promise<T>): Promise<T> {
  await db.pg.query("select set_config('request.headers', $1, false)", [JSON.stringify({ "cf-connecting-ip": ip })]);
  try {
    return await asAnon(fn);
  } finally {
    await db.pg.query("select set_config('request.headers', '', false)");
  }
}

const ALL_CHECKS = {
  transport_type: true, name_direction: true, endpoints: true, stops: true,
  geometry: true, boarding_dropoff: true, fares: true, passenger_categories: true,
};

async function route(publish: boolean) {
  const stops: string[] = [];
  for (let i = 0; i < 2; i++) {
    const { rows } = await q("insert into public.stops (name, latitude, longitude) values ($1, 0.001, 0.001) returning id", [`Report Test Stop ${++n}`]);
    stops.push(rows[0].id as string);
  }
  const data = {
    code: `RT-${++n}`, name: `Report Test Route ${n}`, transport_type: "jeepney", origin_label: "A", destination_label: "B",
    directions: [{ direction: "outbound", stops: stops.map((stop_id) => ({ stop_id })), geometry: line([0, 0], [0.01, 0.01]), geometry_source: "test" }],
  };
  const id = await asAdmin(async () => (await q("select public.save_route(null, $1::jsonb) as id", [JSON.stringify(data)])).rows[0].id as string);
  if (publish) {
    await asAdmin(() => q("select public.verify_route($1, '2026-01-15', 'Fictional source', $2::jsonb, null)", [id, JSON.stringify(ALL_CHECKS)]));
    await asAdmin(() => q("update public.routes set status = 'active' where id = $1", [id]));
  }
  return { id, stops };
}

const DESC = "The fare shown for this ride is not what I paid.";
type Report = { route_id?: string | null; stop_id?: string | null; report_type?: string; direction?: string | null; description?: string; reporter_contact?: string | null };
let ipCounter = 0;
const freshIp = () => `203.0.113.${++ipCounter}`;

/** Submits as a new visitor each time unless told otherwise, so tests do not share a quota. */
function submit(r: Report, ip = freshIp()) {
  const row = { report_type: "other", description: DESC, ...r };
  const cols = Object.keys(row);
  return asVisitor(ip, () =>
    q(`insert into public.route_reports (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")})`, Object.values(row)),
  );
}
const stored = async (desc: string) => (await q("select * from public.route_reports where description = $1", [desc])).rows;

describe("valid reports", () => {
  it("accepts a report about each kind of problem, with and without a reference", async () => {
    await submit({ report_type: "incorrect_route", route_id: live.id, description: "This route no longer goes there now." });
    await submit({ report_type: "incorrect_direction", route_id: live.id, direction: "inbound", description: "The inbound direction is reversed." });
    await submit({ report_type: "incorrect_fare", route_id: live.id, description: "The student fare is wrong for this route." });
    await submit({ report_type: "incorrect_stop", stop_id: live.stops[0], description: "This stop is on the wrong side of the road." });
    await submit({ report_type: "missing_route", description: "There is a route along the river that is missing." });
    await submit({ report_type: "missing_stop", description: "A stop near the market is not listed at all." });
    await submit({ report_type: "other", description: "Something else is wrong with the map data." });
    expect(await stored("This route no longer goes there now.")).toHaveLength(1);
  });

  it("needs no account, and starts as a pending claim that nobody has verified", async () => {
    await submit({ description: "A report from somebody who never signed in." });
    const row = (await stored("A report from somebody who never signed in."))[0];
    expect(row).toMatchObject({ status: "new", resolution_note: null, resolved_by: null, resolved_at: null });
  });

  it("keeps the contact optional, and accepts none", async () => {
    await submit({ description: "A report with no contact details at all.", reporter_contact: null });
    expect((await stored("A report with no contact details at all."))[0].reporter_contact).toBeNull();
    await submit({ description: "A report that can be answered by email.", reporter_contact: "me@example.test" });
    expect((await stored("A report that can be answered by email."))[0].reporter_contact).toBe("me@example.test");
  });

  it("tidies the text", async () => {
    await submit({ description: "   Extra   spaces \t here, please tidy.  ", reporter_contact: "   " });
    const row = (await stored("Extra spaces here, please tidy."))[0];
    expect(row.reporter_contact).toBeNull();
  });
});

describe("route and stop references", () => {
  it("rejects a route id that does not exist", async () => {
    await expect(submit({ report_type: "incorrect_route", route_id: "00000000-0000-4000-8000-00000000dead" })).rejects.toThrow();
  });

  it("rejects a malformed route id", async () => {
    await expect(submit({ report_type: "incorrect_route", route_id: "not-a-uuid" })).rejects.toThrow();
    await expect(submit({ report_type: "incorrect_route", route_id: "1 or 1=1" })).rejects.toThrow();
  });

  it("rejects a route that is not public, so the endpoint cannot be used to probe for drafts", async () => {
    await expect(submit({ report_type: "incorrect_route", route_id: draft.id })).rejects.toThrow(/row-level security/);
    const missing = await submit({ report_type: "incorrect_route", route_id: "00000000-0000-4000-8000-00000000dead" }).catch((e: Error) => e.message);
    const hidden = await submit({ report_type: "incorrect_route", route_id: draft.id }).catch((e: Error) => e.message);
    expect(hidden).toBe(missing); // the two are indistinguishable
  });

  it("rejects an unverified stop and a stop that does not exist", async () => {
    await expect(submit({ report_type: "incorrect_stop", stop_id: draft.stops[0] })).rejects.toThrow();
    await expect(submit({ report_type: "incorrect_stop", stop_id: "00000000-0000-4000-8000-00000000dead" })).rejects.toThrow();
  });

  it("requires each kind of report to say what it is about", async () => {
    await expect(submit({ report_type: "incorrect_route" })).rejects.toThrow(/type_has_subject/);
    await expect(submit({ report_type: "incorrect_fare" })).rejects.toThrow(/type_has_subject/);
    await expect(submit({ report_type: "incorrect_stop" })).rejects.toThrow(/type_has_subject/);
    await expect(submit({ report_type: "incorrect_direction", route_id: live.id })).rejects.toThrow(/type_has_subject/);
    await expect(submit({ report_type: "other", direction: "inbound" })).rejects.toThrow(/needs a route/);
  });
});

describe("input limits and malicious input", () => {
  const bad = (r: Report) => expect(submit(r)).rejects.toThrow();

  it("rejects text that is too short or too long", async () => {
    await bad({ description: "too short" });
    await bad({ description: "          " });
    await bad({ description: "x".repeat(2001) });
    await bad({ reporter_contact: "c".repeat(201) });
    await submit({ description: "y".repeat(2000) });
  });

  it("rejects control characters", async () => {
    await bad({ description: "Contains a bell \u0007 character, which is not text." });
    await bad({ description: "Contains an escape \u001b[31m sequence in the text." });
    await bad({ description: "A fine description of the problem.", reporter_contact: "me@example.test\r\nBcc: x@example.test" });
  });

  it("rejects link-stuffed spam but allows a couple of links", async () => {
    await bad({ description: "Buy now http://a.example http://b.example https://c.example www.d.example" });
    await submit({ description: "See https://example.test/a and https://example.test/b for the notice." });
  });

  it("stores markup and SQL as inert text", async () => {
    const evil = "<script>alert(1)</script> '; drop table public.routes; -- really wrong";
    await submit({ description: evil, reporter_contact: "<b>x</b>" });
    expect((await stored(evil))[0].description).toBe(evil); // never executed; the UI escapes it
    expect(Number((await q("select count(*)::int c from public.routes")).rows[0].c)).toBeGreaterThan(0);
  });

  it("refuses attempts to set fields a visitor does not control", async () => {
    for (const extra of [{ status: "resolved" }, { id: "00000000-0000-4000-8000-000000000042" }, { resolution_note: "Looks fine" }, { resolved_by: admin }, { created_at: "2001-01-01" }]) {
      await expect(submit(extra as Report)).rejects.toThrow(/permission denied/);
    }
  });

  it("does not let a visitor read reports back, including their own", async () => {
    await submit({ description: "Can I read this back afterwards?" });
    const rows = await asAnon(() => q("select id from public.route_reports").then((r) => r.rows).catch(() => []));
    expect(rows).toEqual([]);
  });
});

describe("rate limiting", () => {
  it("allows five reports an hour per client, then refuses", async () => {
    const ip = "198.51.100.7";
    for (let i = 0; i < 5; i++) await submit({ description: `Rate limit report number ${i} from one client.` }, ip);
    await expect(submit({ description: "Rate limit report number 6 from one client." }, ip)).rejects.toThrow(/Too many reports/);
    expect(await stored("Rate limit report number 6 from one client.")).toHaveLength(0);
  });

  it("counts each client separately", async () => {
    for (let i = 0; i < 5; i++) await submit({ description: `Client A report ${i} for the separate test.` }, "198.51.100.20");
    await expect(submit({ description: "Client A report 6 for the separate test." }, "198.51.100.20")).rejects.toThrow(/Too many/);
    await submit({ description: "Client B is not affected by client A." }, "198.51.100.21");
  });

  it("does not use up the quota on rejected reports", async () => {
    const ip = "198.51.100.30";
    for (let i = 0; i < 10; i++) await expect(submit({ description: "short" }, ip)).rejects.toThrow();
    for (let i = 0; i < 5; i++) await submit({ description: `Valid report ${i} after many invalid ones.` }, ip);
  });

  it("keeps only a salted hash of the client, never the address", async () => {
    const dump = JSON.stringify((await q("select * from private.report_throttle")).rows);
    expect(dump).not.toContain("198.51.100");
    expect(dump).not.toContain("203.0.113");
  });

  it("has a site-wide ceiling as well", async () => {
    await q("insert into private.report_throttle (client_hash) select 'flood-' || g from generate_series(1, 300) g");
    await expect(submit({ description: "Everyone is blocked once the whole site is flooded." })).rejects.toThrow(/Too many/);
    await q("delete from private.report_throttle");
    await submit({ description: "Normal service resumes after the window passes." });
  });

  it("never throttles administrators", async () => {
    for (let i = 0; i < 8; i++) {
      await asAdmin(() => q("insert into public.route_reports (report_type, description) values ('other', $1)", [`Administrator note number ${i} to the file.`]));
    }
  });
});

describe("reports never change official data", () => {
  const OFFICIAL = ["routes", "stops", "route_stops", "route_shapes", "fare_rules", "landmarks"];
  const snapshot = async () =>
    JSON.stringify(
      await Promise.all(OFFICIAL.map(async (t) => (await q(`select to_jsonb(x) j from public.${t} x order by 1`)).rows.map((r) => r.j))),
    );

  it("leaves routes, stops, geometry and fares exactly as they were", async () => {
    const before = await snapshot();
    await submit({ report_type: "incorrect_route", route_id: live.id, description: "Every field of this route is wrong, delete it." });
    await submit({ report_type: "incorrect_fare", route_id: live.id, description: "The fare should be one peso, please change it." });
    await submit({ report_type: "incorrect_stop", stop_id: live.stops[0], description: "This stop should be moved far to the east." });
    expect(await snapshot()).toBe(before);
  });

  it("does not unverify, deactivate or edit anything when reports pile up", async () => {
    for (let i = 0; i < 4; i++) await submit({ report_type: "incorrect_route", route_id: live.id, description: `Report ${i}: this route is definitely wrong.` });
    const r = (await q("select status, verification_status, last_verified_at is not null v from public.routes where id=$1", [live.id])).rows[0];
    expect(r).toEqual({ status: "active", verification_status: "verified", v: true });
  });

  it("is not changed by an administrator resolving or rejecting reports either", async () => {
    await submit({ report_type: "incorrect_route", route_id: live.id, description: "Resolve this one without touching the data." });
    const before = await snapshot();
    const id = (await stored("Resolve this one without touching the data."))[0].id as string;
    await asAdmin(() => q("select public.set_report_status($1, 'reviewing', null)", [id]));
    await asAdmin(() => q("select public.set_report_status($1, 'resolved', 'Checked: the data was already right')", [id]));
    expect(await snapshot()).toBe(before);
  });

  it("has no trigger on reports that writes to official tables", async () => {
    const { rows } = await q(`
      select p.proname from pg_trigger t join pg_proc p on p.oid = t.tgfoid
      where t.tgrelid = 'public.route_reports'::regclass and not t.tgisinternal order by 1`);
    const source = (await Promise.all(rows.map(async (r) => (await q("select pg_get_functiondef(oid) d from pg_proc where proname=$1", [r.proname])).rows[0].d as string))).join("\n");
    expect(source).not.toMatch(/(insert\s+into|update|delete\s+from)\s+public\.(routes|stops|route_stops|route_shapes|fare_rules|landmarks)\b/i);
  });
});

describe("resolution workflow", () => {
  const make = async (description: string) => {
    await submit({ description });
    return (await stored(description))[0].id as string;
  };
  const set = (id: string, status: string, note: string | null) => asAdmin(() => q("select public.set_report_status($1, $2, $3)", [id, status, note]));

  it("moves through pending, reviewing, resolved and rejected", async () => {
    const id = await make("Walk this report through every status.");
    for (const [status, note] of [["reviewing", null], ["resolved", "Corrected the stop name"], ["new", null], ["rejected", "Could not be reproduced"]] as const) {
      await set(id, status, note);
      expect((await q("select status from public.route_reports where id=$1", [id])).rows[0].status).toBe(status);
    }
  });

  it("will not close a report without saying why", async () => {
    const id = await make("Closing needs an explanation of the outcome.");
    await expect(set(id, "resolved", null)).rejects.toThrow(/how this report was resolved/);
    await expect(set(id, "rejected", "  ")).rejects.toThrow(/why it was rejected/);
    await expect(set(id, "reviewing", "x".repeat(1001))).rejects.toThrow(/too long/);
  });

  it("records who, when and why, and the audit log keeps the history without the contact", async () => {
    await submit({ description: "Audit history for this resolution record.", reporter_contact: "private-person@example.test" });
    const id = (await stored("Audit history for this resolution record."))[0].id as string;
    await set(id, "reviewing", null);
    await set(id, "resolved", "Updated the stop and re-verified");
    const row = (await q("select resolution_note n, resolved_by b, resolved_at is not null t from public.route_reports where id=$1", [id])).rows[0];
    expect(row).toEqual({ n: "Updated the stop and re-verified", b: admin, t: true });
    const log = (await q("select admin_id, previous, changes from public.audit_logs where entity_type='route_reports' and entity_id=$1 order by id", [id])).rows;
    expect(log.map((l) => (l.changes as { status: string }).status)).toEqual(["reviewing", "resolved"]);
    expect(log[1].previous).toMatchObject({ status: "reviewing" });
    expect(log.every((l) => l.admin_id === admin)).toBe(true);
    expect(JSON.stringify(log)).not.toContain("private-person");
  });
});

describe("temporary deactivation", () => {
  it("takes a route out of public view, records why, and clears the reason when it is reactivated", async () => {
    const r = await route(true);
    const visible = () => asAnon(async () => Number((await q("select count(*)::int c from public.routes where id=$1", [r.id])).rows[0].c));
    expect(await visible()).toBe(1);

    await asAdmin(() => q("update public.routes set status = 'inactive', deactivation_reason = 'Reported as inaccurate; checking' where id=$1", [r.id]));
    expect(await visible()).toBe(0);
    expect((await q("select deactivation_reason r, deactivated_at is not null t from public.routes where id=$1", [r.id])).rows[0]).toEqual({ r: "Reported as inaccurate; checking", t: true });
    // A report about a route nobody can see any more is refused.
    await expect(submit({ report_type: "incorrect_route", route_id: r.id })).rejects.toThrow();

    await asAdmin(() => q("update public.routes set status = 'active' where id=$1", [r.id]));
    expect(await visible()).toBe(1);
    expect((await q("select deactivation_reason r, deactivated_at t from public.routes where id=$1", [r.id])).rows[0]).toEqual({ r: null, t: null });
  });
});
