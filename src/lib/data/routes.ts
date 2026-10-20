import type { Route } from "@/lib/validation/route";
import { isSampleDataEnabled } from "@/lib/data/config";
import { SAMPLE_ROUTES } from "@/lib/data/sample-routes";

/**
 * Where the returned data came from:
 * - "database": real records (Supabase; not wired up yet)
 * - "sample":   development data, explicitly enabled
 * - "none":     no data source available, so the list is empty
 */
export type DataSource = "database" | "sample" | "none";

export type DataResult<T> =
  | { status: "ok"; data: T; source: DataSource }
  | { status: "error"; message: string };

/**
 * Data-access boundary for routes. Pages depend only on these functions, so
 * the Supabase implementation can replace the body later without touching UI.
 */
export async function getRoutes(): Promise<DataResult<Route[]>> {
  if (isSampleDataEnabled()) {
    return { status: "ok", data: SAMPLE_ROUTES, source: "sample" };
  }
  // TODO(phase 1): query Supabase `routes` once the schema exists.
  return { status: "ok", data: [], source: "none" };
}

export async function getRouteById(id: string): Promise<DataResult<Route | null>> {
  const result = await getRoutes();
  if (result.status === "error") return result;
  return {
    status: "ok",
    data: result.data.find((r) => r.id === id) ?? null,
    source: result.source,
  };
}
