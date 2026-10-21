"use server";

import { z } from "zod";
import { publicStatus } from "@/lib/admin/dashboard";
import { searchStops, type EditorStop } from "@/lib/admin/data";
import { parseCoordinatePair, routeDraftSchema, toSaveRoutePayload } from "@/lib/admin/route-form";
import { describeDbError, done, fail, withAdmin, type ActionResult } from "@/lib/admin/session";
import { todayInManila, verificationInputSchema } from "@/lib/admin/verification";
import { distanceMeters } from "@/lib/routes/geometry";
import type { Json } from "@/types/database";

const idSchema = z.uuid();

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Some values are not valid.";
}

/** Creates a draft route, or updates an existing one, with its directions, stops and geometry. */
export async function saveRouteAction(routeId: string | null, draft: unknown): Promise<ActionResult<{ id: string }>> {
  return withAdmin(async ({ supabase }) => {
    if (routeId !== null && !idSchema.safeParse(routeId).success) return fail("That route id is not valid.");
    const parsed = routeDraftSchema.safeParse(draft);
    if (!parsed.success) return fail(firstIssue(parsed.error));

    const { data, error } = await supabase.rpc("save_route", {
      // A null id creates a new route; the generated type has no way to say "nullable".
      p_route_id: routeId as string,
      p_data: toSaveRoutePayload(parsed.data) as unknown as Json,
    });
    if (error) return fail(describeDbError(error));
    return done({ id: data });
  });
}

export type RouteStatusResult = { status: "draft" | "active" | "inactive"; public: boolean; reason: string };

/** Draft / active / inactive. Only active AND verified routes are ever public. */
export async function setRouteStatusAction(routeId: string, status: "draft" | "active" | "inactive"): Promise<ActionResult<RouteStatusResult>> {
  return withAdmin(async ({ supabase }) => {
    if (!idSchema.safeParse(routeId).success || !["draft", "active", "inactive"].includes(status)) return fail("That request is not valid.");
    const { data, error } = await supabase.from("routes").update({ status }).eq("id", routeId).select("status, verification_status, last_verified_at, is_sample").maybeSingle();
    if (error) return fail(describeDbError(error));
    if (!data) return fail("Route not found.");
    return done({ status: data.status, ...publicStatus(data) });
  });
}

/** Flags a verified route as outdated, which hides it from the public until it is verified again. */
export async function markRouteOutdatedAction(routeId: string): Promise<ActionResult> {
  return withAdmin(async ({ supabase }) => {
    if (!idSchema.safeParse(routeId).success) return fail("That route id is not valid.");
    const { error } = await supabase.from("routes").update({ verification_status: "outdated" }).eq("id", routeId);
    if (error) return fail(describeDbError(error));
    return done(undefined);
  });
}

/** Records who verified the route, when, and against what source, through public.verify_route(). */
export async function verifyRouteAction(input: unknown): Promise<ActionResult> {
  return withAdmin(async ({ supabase }) => {
    const parsed = verificationInputSchema.safeParse(input);
    if (!parsed.success) return fail(firstIssue(parsed.error));
    const v = parsed.data;
    if (v.verifiedOn > todayInManila()) return fail("The verification date can't be in the future.");

    const { error } = await supabase.rpc("verify_route", {
      p_route_id: v.routeId,
      p_verified_on: v.verifiedOn,
      p_source: v.source,
      p_checks: v.checks as unknown as Json,
      p_notes: v.notes || undefined,
    });
    if (error) return fail(describeDbError(error));
    return done(undefined);
  });
}

/** Deletes a route that was never published (draft or unverified, not sample-protected from deletion). */
export async function deleteRouteAction(routeId: string): Promise<ActionResult> {
  return withAdmin(async ({ supabase }) => {
    if (!idSchema.safeParse(routeId).success) return fail("That route id is not valid.");
    const { data: route } = await supabase.from("routes").select("status, verification_status").eq("id", routeId).maybeSingle();
    if (!route) return fail("Route not found.");
    if (route.verification_status === "verified" || route.status === "active") {
      return fail("Only routes that are not active and not verified can be deleted. Set it to inactive first, or keep it for the record.");
    }
    const { error } = await supabase.from("routes").delete().eq("id", routeId);
    if (error) return fail(describeDbError(error));
    return done(undefined);
  });
}

// ---------------------------------------------------------------------------
// Stops
// ---------------------------------------------------------------------------

export async function searchStopsAction(query: string): Promise<ActionResult<EditorStop[]>> {
  return withAdmin(async ({ supabase }) => {
    if (typeof query !== "string" || query.length > 100) return fail("That search is not valid.");
    return done(await searchStops(supabase, query));
  });
}

const stopInputSchema = z.object({
  name: z.string().trim().min(1, "Give the stop a name.").max(200),
  latitude: z.number(),
  longitude: z.number(),
  barangay: z.string().trim().max(100),
  landmark: z.string().trim().max(300),
  pickup: z.boolean(),
  dropoff: z.boolean(),
});

function stopFields(input: unknown) {
  const parsed = stopInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) } as const;
  const v = parsed.data;
  const pair = parseCoordinatePair(String(v.latitude), String(v.longitude));
  if (!pair.ok) return { ok: false, error: Object.values(pair.errors).filter(Boolean).join(" ") } as const;
  return { ok: true, v, coordinate: pair.coordinate } as const;
}

/** Creates an unverified stop (verification happens with its route). Refuses an obvious duplicate. */
export async function createStopAction(input: unknown): Promise<ActionResult<EditorStop>> {
  return withAdmin(async ({ supabase }) => {
    const f = stopFields(input);
    if (!f.ok) return fail(f.error);
    const { v, coordinate } = f;

    const box = 0.0004; // about 45 m
    const { data: near, error: nearError } = await supabase
      .from("stops").select("id, name, latitude, longitude")
      .gte("latitude", coordinate.lat - box).lte("latitude", coordinate.lat + box)
      .gte("longitude", coordinate.lng - box).lte("longitude", coordinate.lng + box);
    if (nearError) return fail(describeDbError(nearError));
    const twin = (near ?? []).find(
      (s) => s.name.trim().toLowerCase() === v.name.toLowerCase() && distanceMeters(coordinate, { lat: s.latitude, lng: s.longitude }) <= 10,
    );
    if (twin) return fail(`A stop called “${twin.name}” already exists at this spot. Search for it and add that one instead.`);

    const { data, error } = await supabase.from("stops").insert({
      name: v.name, latitude: coordinate.lat, longitude: coordinate.lng,
      barangay: v.barangay || null, landmark_description: v.landmark || null,
      pickup_allowed: v.pickup, dropoff_allowed: v.dropoff,
    }).select("*").single();
    if (error) return fail(describeDbError(error));
    return done({ id: data.id, name: data.name, latitude: data.latitude, longitude: data.longitude, status: data.verification_status, barangay: data.barangay });
  });
}

/** Edits a stop. A verified stop that changes drops back to unverified, along with the routes using it. */
export async function updateStopAction(stopId: string, input: unknown): Promise<ActionResult<EditorStop>> {
  return withAdmin(async ({ supabase }) => {
    if (!idSchema.safeParse(stopId).success) return fail("That stop id is not valid.");
    const f = stopFields(input);
    if (!f.ok) return fail(f.error);
    const { v, coordinate } = f;
    const { data, error } = await supabase.from("stops").update({
      name: v.name, latitude: coordinate.lat, longitude: coordinate.lng,
      barangay: v.barangay || null, landmark_description: v.landmark || null,
      pickup_allowed: v.pickup, dropoff_allowed: v.dropoff,
    }).eq("id", stopId).select("*").maybeSingle();
    if (error) return fail(describeDbError(error));
    if (!data) return fail("Stop not found.");
    return done({ id: data.id, name: data.name, latitude: data.latitude, longitude: data.longitude, status: data.verification_status, barangay: data.barangay });
  });
}
