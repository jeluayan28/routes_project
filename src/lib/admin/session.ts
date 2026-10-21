import { redirect } from "next/navigation";
import { readPublicEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export type AdminClient = Awaited<ReturnType<typeof createClient>>;

export type AdminContext =
  | { status: "unconfigured" }
  | { status: "signed-out" }
  | { status: "not-admin"; email: string | null }
  | { status: "admin"; supabase: AdminClient; userId: string; email: string | null };

/**
 * Who is calling. The user is confirmed with the Auth server (getUser), then
 * checked against the administrator allow-list in the database. Being signed in
 * is never enough.
 */
export async function getAdminContext(): Promise<AdminContext> {
  if (!readPublicEnv().configured) return { status: "unconfigured" };
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user || data.user.is_anonymous) return { status: "signed-out" };
  const { data: isAdmin, error: rpcError } = await supabase.rpc("is_current_user_admin");
  if (rpcError || isAdmin !== true) return { status: "not-admin", email: data.user.email ?? null };
  return { status: "admin", supabase, userId: data.user.id, email: data.user.email ?? null };
}

/** For pages: redirects signed-out visitors, returns the context otherwise. */
export async function requireAdminPage() {
  const ctx = await getAdminContext();
  if (ctx.status === "signed-out") redirect("/admin/login");
  return ctx;
}

export class NotAuthorizedError extends Error {
  constructor() {
    super("You are not authorised to do that.");
  }
}

/** For Server Actions: they are public endpoints, so every one calls this first. */
export async function requireAdminAction() {
  const ctx = await getAdminContext();
  if (ctx.status !== "admin") throw new NotAuthorizedError();
  return ctx;
}

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

export const fail = (error: string, fieldErrors?: Record<string, string>): ActionResult<never> => ({ ok: false, error, fieldErrors });
export const done = <T,>(data: T): ActionResult<T> => ({ ok: true, data });

/** Turns a Postgres/PostgREST error into something an administrator can act on. */
export function describeDbError(error: { code?: string; message?: string; details?: string | null }): string {
  const message = error.message ?? "";
  switch (error.code) {
    case "42501":
      return message.includes("Administrators only") ? "Only administrators can do that." : "You don't have permission to do that.";
    case "23505":
      if (message.includes("route_stops_unique_stop")) return "A stop can appear only once in a direction.";
      if (message.includes("routes_code_key")) return "Another route already uses that code.";
      if (message.includes("import_batches_pkey")) return "This import was already committed.";
      return "That record already exists.";
    case "23P01":
      return "That fare overlaps another fare for the same route, stops and passenger type. Change the dates or edit the existing fare.";
    case "23503":
      return message.includes("fare rule") || message.includes("is_not_on") ? message : "That record is still in use or refers to something that doesn't exist.";
    case "23514":
      if (message.includes("sample_never_verified")) return "Sample data can never be verified.";
      return message || "A value is not allowed.";
    case "22P02":
    case "22023":
      return message || "A value is malformed.";
    case "P0001":
    case "P0002":
      return message;
    default:
      // Our own functions raise readable messages with check_violation / no_data_found.
      if (/^(Routes?|Stops?|Fares?|Verification|The |A |An |Sample|Starting|Geometry|Every|Direction|Administrators)/.test(message)) return message;
      return "The database rejected that change.";
  }
}

/** Runs a Server Action body as a verified administrator and never lets an exception escape as a crash. */
export async function withAdmin<T>(
  body: (ctx: Extract<AdminContext, { status: "admin" }>) => Promise<ActionResult<T>>,
): Promise<ActionResult<T>> {
  try {
    return await body(await requireAdminAction());
  } catch (error) {
    if (error instanceof NotAuthorizedError) return fail(error.message);
    console.error("Admin action failed", error);
    return fail("Something went wrong. Please try again.");
  }
}
