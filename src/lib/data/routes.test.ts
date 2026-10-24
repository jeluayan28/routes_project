import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const from = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from }) }));

import { getRouteById, getRoutes } from "./routes";

type Result = { data: unknown; error: unknown };

/** Chainable query double that resolves to `result`. */
function query(result: Result) {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order"]) q[m] = () => q;
  q.then = (resolve: (v: Result) => unknown) => resolve(result);
  return q;
}

const configured = () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_x");
};
const unconfigured = () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
};

beforeEach(() => {
  from.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("getRoutes", () => {
  it("returns database routes mapped to the app model", async () => {
    configured();
    from.mockImplementation((table: string) =>
      table === "routes"
        ? query({
            data: [
              {
                id: "r1",
                code: "R1",
                name: "One",
                transport_type: "minibus",
                verification_status: "verified",
                route_stops: [
                  {
                    direction: "outbound",
                    stop_order: 1,
                    boarding_allowed: null,
                    dropoff_allowed: null,
                    stops: {
                      id: "s1",
                      name: "S1",
                      latitude: 8.9,
                      longitude: 125.5,
                      pickup_allowed: true,
                      dropoff_allowed: true,
                      verification_status: "verified",
                    },
                  },
                ],
              },
            ],
            error: null,
          })
        : query({ data: [], error: null }),
    );
    const result = await getRoutes();
    expect(result).toMatchObject({ status: "ok", source: "database" });
    if (result.status === "ok") expect(result.data[0].directions[0].stops[0].name).toBe("S1");
  });

  it("returns an empty list (not fixtures) when the database has no routes", async () => {
    configured();
    from.mockImplementation(() => query({ data: [], error: null }));
    expect(await getRoutes()).toEqual({ status: "ok", data: [], source: "database" });
  });

  it("returns an error, never fixtures, when the request fails", async () => {
    configured();
    from.mockImplementation((table: string) =>
      table === "routes" ? query({ data: null, error: { message: "boom" } }) : query({ data: [], error: null }),
    );
    const result = await getRoutes();
    expect(result.status).toBe("error");
    expect(JSON.stringify(result)).not.toContain("sample");
  });

  it("returns an error when the shapes request fails", async () => {
    configured();
    from.mockImplementation((table: string) =>
      table === "routes" ? query({ data: [], error: null }) : query({ data: null, error: { message: "boom" } }),
    );
    expect((await getRoutes()).status).toBe("error");
  });

  it("returns an error if the client throws", async () => {
    configured();
    from.mockImplementation(() => {
      throw new Error("network down");
    });
    expect((await getRoutes()).status).toBe("error");
  });

  it("returns an error when Supabase is not configured", async () => {
    unconfigured();
    expect((await getRoutes()).status).toBe("error");
    expect(from).not.toHaveBeenCalled();
  });

  it("uses fixtures only when sample data is explicitly enabled", async () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_SAMPLE_DATA", "true");
    expect(await getRoutes()).toMatchObject({ status: "ok", source: "sample" });
    expect(from).not.toHaveBeenCalled();
  });
});

describe("getRouteById", () => {
  it("propagates errors", async () => {
    unconfigured();
    expect((await getRouteById("x")).status).toBe("error");
  });
});
