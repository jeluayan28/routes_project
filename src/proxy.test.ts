import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { config, proxy } from "./proxy";

afterEach(() => vi.unstubAllEnvs());

const configured = () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example-project.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_fake");
};
const req = (path: string) => new NextRequest(`http://localhost:3000${path}`);

describe("admin proxy", () => {
  it("only runs for the admin area", () => {
    expect(config.matcher).toEqual(["/admin", "/admin/:path*"]);
  });

  it("sends a signed-out visitor to the login page for every admin path", async () => {
    configured();
    for (const path of ["/admin", "/admin/routes", "/admin/routes/new", "/admin/import", "/admin/stops?filter=suspect"]) {
      const res = await proxy(req(path));
      expect(res.status, path).toBe(307);
      expect(new URL(res.headers.get("location")!).pathname, path).toBe("/admin/login");
    }
  });

  it("does not carry the original query string to the login page", async () => {
    configured();
    const res = await proxy(req("/admin/stops?q=secret"));
    expect(new URL(res.headers.get("location")!).search).toBe("");
  });

  it("lets a signed-out visitor see the login page itself", async () => {
    configured();
    const res = await proxy(req("/admin/login"));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("does nothing when the database is not configured (pages show their own notice)", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    const res = await proxy(req("/admin/routes"));
    expect(res.status).toBe(200);
  });
});
