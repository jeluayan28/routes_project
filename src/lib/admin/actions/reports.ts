"use server";

import { z } from "zod";
import { describeDbError, done, fail, withAdmin, type ActionResult } from "@/lib/admin/session";
import { REPORT_STATUSES, type ReportStatus } from "@/lib/admin/reports";

const inputSchema = z.object({
  reportId: z.uuid(),
  status: z.enum(REPORT_STATUSES as [ReportStatus, ...ReportStatus[]]),
  note: z.string().trim().max(1000, "Keep the note under 1000 characters.").optional(),
});

/**
 * Moves a public report to pending, reviewing, resolved or rejected, with a note.
 * Closing a report (resolved or rejected) requires a note saying why. Only
 * administrators can do this (checked here, in the database function, and by
 * row-level security); the database records who and when, and the audit trigger
 * records the previous status. It never changes the route, stop or fare the
 * report is about: correcting data is a separate, deliberate edit.
 */
export async function setReportStatusAction(input: unknown): Promise<ActionResult<{ id: string; status: ReportStatus }>> {
  return withAdmin(async ({ supabase }) => {
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "That report or status is not valid.");
    const { reportId, status, note } = parsed.data;
    if ((status === "resolved" || status === "rejected") && (note ?? "").length < 3) {
      return fail("Say how this report was resolved, or why it was rejected.", { note: "A note is required to close a report." });
    }
    const { error } = await supabase.rpc("set_report_status", { p_report_id: reportId, p_status: status, p_note: note });
    if (error) return fail(describeDbError(error));
    return done({ id: reportId, status });
  });
}
