import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Server Actions are public HTTP endpoints: anyone can POST to one without ever
 * loading an admin page. These tests call every administrator action directly,
 * as an attacker would, and check that none does anything unless the caller is
 * signed in AND on the administrator allow-list (decided by the database).
 */

type Who = "admin" | "non-admin" | "signed-out" | "anonymous-session" | "rpc-error";
let who: Who = "non-admin";
let configured = true;
const touched: string[] = [];

const builder = (name: string): unknown =>
  new Proxy(() => undefined, {
    get: (_t, prop) => {
      if (prop === "then") return (resolve: (v: unknown) => void) => resolve({ data: [], error: null });
      return (...args: unknown[]) => {
        touched.push(`${name}.${String(prop)}`);
        void args;
        return builder(name);
      };
    },
  });

const supabase = {
  auth: {
    getUser: async () => {
      if (who === "signed-out") return { data: { user: null }, error: null };
      if (who === "anonymous-session") return { data: { user: { id: "u", is_anonymous: true } }, error: null };
      return { data: { user: { id: "u1", email: "someone@example.test", is_anonymous: false } }, error: null };
    },
  },
  rpc: async (fn: string) => {
    if (fn === "is_current_user_admin") {
      if (who === "rpc-error") return { data: null, error: { message: "boom" } };
      return { data: who === "admin", error: null };
    }
    touched.push(`rpc.${fn}`);
    return { data: null, error: null };
  },
  from: (table: string) => {
    touched.push(`from.${table}`);
    return builder(table);
  },
};

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => supabase }));
vi.mock("@/lib/env", () => ({
  readPublicEnv: () => (configured ? { configured: true, env: {} } : { configured: false }),
}));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("redirect"); } }));

import { changeFareAction, deleteFareAction, endFareAction, saveFareAction } from "@/lib/admin/actions/fares";
import { commitImportAction, previewImportAction } from "@/lib/admin/actions/import";
import { setReportStatusAction } from "@/lib/admin/actions/reports";
import {
  createStopAction, deleteRouteAction, markRouteOutdatedAction, nearbyStopsAction, saveRouteAction,
  searchStopsAction, setRouteStatusAction, updateStopAction, verifyRouteAction,
} from "@/lib/admin/actions/routes";

const ID = "11111111-1111-4111-8111-111111111111";
const emptyForm = () => new FormData();

/** Valid-looking input for each action, so a failure can only be about authorization. */
const CALLS: [string, () => Promise<{ ok: boolean }>][] = [
  ["saveFareAction", () => saveFareAction({ id: null, routeId: ID, fromStopId: null, toStopId: null, passengerType: "regular", amount: "10", effectiveFrom: "2026-01-01", effectiveUntil: "", source: "x" })],
  ["deleteFareAction", () => deleteFareAction(ID)],
  ["changeFareAction", () => changeFareAction({ fareId: ID, amount: "11", effectiveFrom: "2026-07-01", source: "A source" })],
  ["endFareAction", () => endFareAction({ fareId: ID, effectiveUntil: "2026-07-01" })],
  ["setReportStatusAction", () => setReportStatusAction({ reportId: ID, status: "resolved" })],
  ["saveRouteAction", () => saveRouteAction(null, { name: "R", code: "", transportType: "jeepney", description: "", originLabel: "", destinationLabel: "", directions: [{ kind: "outbound", stops: [], lines: [], geometrySource: "" }] })],
  ["setRouteStatusAction", () => setRouteStatusAction(ID, "active")],
  ["markRouteOutdatedAction", () => markRouteOutdatedAction(ID)],
  ["verifyRouteAction", () => verifyRouteAction({ routeId: ID })],
  ["deleteRouteAction", () => deleteRouteAction(ID)],
  ["searchStopsAction", () => searchStopsAction("a")],
  ["nearbyStopsAction", () => nearbyStopsAction(8.95, 125.54)],
  ["createStopAction", () => createStopAction({ name: "S", latitude: 8.95, longitude: 125.54, barangay: "", landmark: "", pickup: true, dropoff: true })],
  ["updateStopAction", () => updateStopAction(ID, { name: "S", latitude: 8.95, longitude: 125.54, barangay: "", landmark: "", pickup: true, dropoff: true })],
  ["previewImportAction", () => previewImportAction(emptyForm()) as Promise<{ ok: boolean }>],
  ["commitImportAction", () => commitImportAction(emptyForm()) as Promise<{ ok: boolean }>],
];

beforeEach(() => {
  who = "non-admin";
  configured = true;
  touched.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe.each<Who>(["non-admin", "signed-out", "anonymous-session", "rpc-error"])("when the caller is %s", (caller) => {
  it.each(CALLS)("%s is refused and touches no data", async (_name, call) => {
    who = caller;
    const result = await call();
    expect(result.ok).toBe(false);
    expect(touched).toEqual([]);
  });
});

describe("when the database is not configured", () => {
  it.each(CALLS)("%s is refused", async (_name, call) => {
    configured = false;
    expect((await call()).ok).toBe(false);
    expect(touched).toEqual([]);
  });
});

describe("a client-supplied role is never trusted", () => {
  it("ignores an admin flag smuggled into the input", async () => {
    const result = await setReportStatusAction({ reportId: ID, status: "resolved", isAdmin: true, role: "admin", admin: true });
    expect(result.ok).toBe(false);
    expect(touched).toEqual([]);
  });
});

describe("an administrator is let through", () => {
  it("runs the action (so the refusals above are about authorization, not broken inputs)", async () => {
    who = "admin";
    await setReportStatusAction({ reportId: ID, status: "resolved" });
    expect(touched).toContain("from.route_reports");

    touched.length = 0;
    await changeFareAction({ fareId: ID, amount: "11", effectiveFrom: "2026-07-01", source: "A source" });
    expect(touched).toContain("rpc.change_fare");
  });

  it("still validates input", async () => {
    who = "admin";
    expect((await setReportStatusAction({ reportId: "not-a-uuid", status: "resolved" })).ok).toBe(false);
    expect((await setReportStatusAction({ reportId: ID, status: "deleted" })).ok).toBe(false);
    expect((await changeFareAction({ fareId: ID, amount: "-5", effectiveFrom: "2026-07-01", source: "A source" })).ok).toBe(false);
    expect(touched).toEqual([]);
  });
});
