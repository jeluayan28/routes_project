"use server";

import { z } from "zod";
import { fareInputSchema } from "@/lib/admin/fare-form";
import { describeDbError, done, fail, withAdmin, type ActionResult } from "@/lib/admin/session";
import type { Database } from "@/types/database";

type FareRow = Database["public"]["Tables"]["fare_rules"]["Row"];

/**
 * Creates or updates a fare rule (flat, or origin to destination) with its
 * passenger category and effective dates. A saved fare is always unverified until
 * the route is verified, and the database rejects overlapping periods and stops
 * that are not on the route.
 */
export async function saveFareAction(input: unknown): Promise<ActionResult<FareRow>> {
  return withAdmin(async ({ supabase }) => {
    const parsed = fareInputSchema.safeParse(input);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return fail(issue?.message ?? "Some values are not valid.", issue?.path.length ? { [String(issue.path[0])]: issue.message } : undefined);
    }
    const f = parsed.data;
    const row = {
      route_id: f.routeId,
      from_stop_id: f.fromStopId,
      to_stop_id: f.toStopId,
      passenger_type: f.passengerType,
      amount: Number(f.amount),
      effective_from: f.effectiveFrom,
      effective_until: f.effectiveUntil || null,
      source_description: f.source || null,
    };
    const query = f.id
      ? supabase.from("fare_rules").update(row).eq("id", f.id).eq("route_id", f.routeId)
      : supabase.from("fare_rules").insert(row);
    const { data, error } = await query.select("*").maybeSingle();
    if (error) return fail(describeDbError(error));
    if (!data) return fail("Fare not found.");
    return done(data);
  });
}

export async function deleteFareAction(fareId: string): Promise<ActionResult> {
  return withAdmin(async ({ supabase }) => {
    if (!z.uuid().safeParse(fareId).success) return fail("That fare id is not valid.");
    const { error } = await supabase.from("fare_rules").delete().eq("id", fareId);
    if (error) return fail(describeDbError(error));
    return done(undefined);
  });
}
