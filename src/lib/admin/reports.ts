import type { Database } from "@/types/database";

export type ReportStatus = Database["public"]["Enums"]["report_status"];
export type ReportType = Database["public"]["Enums"]["report_type"];

/**
 * The database keeps `new | reviewing | resolved | rejected`. Administrators see
 * them as Pending, Reviewed, Resolved and Rejected.
 */
export const REPORT_STATUSES: readonly ReportStatus[] = ["new", "reviewing", "resolved", "rejected"];

export const REPORT_STATUS_LABEL: Record<ReportStatus, string> = {
  new: "Pending",
  reviewing: "Reviewed",
  resolved: "Resolved",
  rejected: "Rejected",
};

export const REPORT_TYPE_LABEL: Record<ReportType, string> = {
  incorrect_route: "Incorrect route",
  incorrect_stop: "Incorrect stop",
  incorrect_fare: "Incorrect fare",
  missing_route: "Missing route",
  missing_stop: "Missing stop",
  other: "Other",
};

/** Pending and reviewed reports are still open; resolved and rejected are closed. */
export const isOpenReport = (status: ReportStatus) => status === "new" || status === "reviewing";

export const parseReportStatus = (value: string | undefined): ReportStatus | null => REPORT_STATUSES.find((s) => s === value) ?? null;
