"use server";

import { z } from "zod";
import { changeFareSchema, endFareSchema, fareInputSchema } from "@/lib/admin/fare-form";
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

/**
 * A new price from a date. The old rule is ended the day before and kept; the new
 * rule is unverified until the route is verified again.
 */
export async function changeFareAction(input: unknown): Promise<ActionResult<FareRow[]>> {
  return withAdmin(async ({ supabase }) => {
    const parsed = changeFareSchema.safeParse(input);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return fail(issue?.message ?? "Some values are not valid.", issue?.path.length ? { [String(issue.path[0])]: issue.message } : undefined);
    }
    const f = parsed.data;
    const { data, error } = await supabase.rpc("change_fare", {
      p_fare_id: f.fareId,
      p_amount: Number(f.amount),
      p_effective_from: f.effectiveFrom,
      p_source: f.source,
    });
    if (error) return fail(describeDbError(error));
    // The new rule and the old one it ended, so the editor can show both.
    const rows = await supabase.from("fare_rules").select("*").in("id", [data, f.fareId]);
    if (rows.error) return fail(describeDbError(rows.error));
    return done(rows.data ?? []);
  });
}

/** Stops a fare on a date without replacing it. A verified fare keeps its verification. */
export async function endFareAction(input: unknown): Promise<ActionResult<FareRow | null>> {
  return withAdmin(async ({ supabase }) => {
    const parsed = endFareSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Some values are not valid.");
    const { error } = await supabase.rpc("end_fare", { p_fare_id: parsed.data.fareId, p_effective_until: parsed.data.effectiveUntil });
    if (error) return fail(describeDbError(error));
    const row = await supabase.from("fare_rules").select("*").eq("id", parsed.data.fareId).maybeSingle();
    return done(row.data ?? null);
  });
}
