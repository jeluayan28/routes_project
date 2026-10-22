"use server";

import { z } from "zod";
import { describeDbError, done, fail, withAdmin, type ActionResult } from "@/lib/admin/session";
import { REPORT_STATUSES, type ReportStatus } from "@/lib/admin/reports";

const inputSchema = z.object({ reportId: z.uuid(), status: z.enum(REPORT_STATUSES as [ReportStatus, ...ReportStatus[]]) });

/**
 * Moves a public report to pending, reviewed, resolved or rejected. Only
 * administrators can (checked here and by row-level security), and the database
 * audit trigger records who did it and what the status was before.
 */
export async function setReportStatusAction(input: unknown): Promise<ActionResult<{ id: string; status: ReportStatus }>> {
  return withAdmin(async ({ supabase }) => {
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) return fail("That report or status is not valid.");
    const { data, error } = await supabase
      .from("route_reports")
      .update({ status: parsed.data.status })
      .eq("id", parsed.data.reportId)
      .select("id, status")
      .maybeSingle();
    if (error) return fail(describeDbError(error));
    if (!data) return fail("Report not found.");
    return done(data);
  });
}
