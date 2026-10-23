import type { SupabaseClient } from "@supabase/supabase-js";
import { reportInputSchema, type ReportInput } from "@/lib/reports/schema";
import type { Database } from "@/types/database";

export type SubmitResult =
  | { ok: true }
  | { ok: false; kind: "invalid"; fieldErrors: Record<string, string>; message: string }
  | { ok: false; kind: "rate-limited" | "not-found" | "rejected" | "unavailable"; message: string };

type Failure = { code?: string; message?: string };

/** Turns what the database said into something a visitor can act on. Never echoes SQL. */
export function describeSubmitError(error: Failure): Extract<SubmitResult, { ok: false; kind: "rate-limited" | "not-found" | "rejected" | "unavailable" }> {
  const message = error.message ?? "";
  if (/too many reports/i.test(message)) {
    return { ok: false, kind: "rate-limited", message: "You've sent several reports recently. Please wait a while and try again." };
  }
  if (error.code === "42501" || /row-level security/i.test(message)) {
    return { ok: false, kind: "not-found", message: "That route or stop can't be reported. It may have been removed or isn't published." };
  }
  if (error.code === "23514" || error.code === "22P02" || error.code === "23503") {
    return { ok: false, kind: "rejected", message: "That report couldn't be accepted. Please check what you entered and try again." };
  }
  return { ok: false, kind: "unavailable", message: "We couldn't send your report right now. Please try again in a moment." };
}

/**
 * Sends a correction report. It only ever adds a row to the reports table (with
 * the publishable key and no account); a report is a claim for an administrator
 * to check, never a change to the data. A filled-in honeypot is answered as a
 * success so a bot learns nothing, but nothing is sent.
 */
export async function submitReport(client: Pick<SupabaseClient<Database>, "from">, input: ReportInput): Promise<SubmitResult> {
  const parsed = reportInputSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0] ?? "form")] ??= issue.message;
    return { ok: false, kind: "invalid", fieldErrors, message: "Please fix the highlighted fields." };
  }
  const r = parsed.data;
  if (r.website) return { ok: true };

  try {
    const { error } = await client.from("route_reports").insert({
      report_type: r.type,
      route_id: r.routeId,
      stop_id: r.stopId,
      direction: r.type === "incorrect_direction" ? r.direction : null,
      description: r.description,
      reporter_contact: r.contact,
    });
    return error ? describeSubmitError(error) : { ok: true };
  } catch {
    return describeSubmitError({});
  }
}
