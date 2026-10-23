import { formatPeso } from "@/lib/format";

export type AuditEntry = {
  id: number;
  admin_id: string | null;
  entity_type: string;
  entity_id: string | null;
  action: "insert" | "update" | "delete";
  /** The row after the change (the row itself for a delete). */
  changes: Record<string, unknown> | null;
  /** For updates: only the columns that changed, with their old values. */
  previous: Record<string, unknown> | null;
  created_at: string;
};

export const AUDIT_ENTITIES = [
  ["routes", "Routes"],
  ["route_verifications", "Route approvals"],
  ["fare_rules", "Fares"],
  ["stops", "Stops"],
  ["route_stops", "Route stops"],
  ["route_shapes", "Route geometry"],
  ["route_reports", "Reports"],
  ["landmarks", "Landmarks"],
] as const;

export type AuditEntity = (typeof AUDIT_ENTITIES)[number][0];

const ENTITY_NOUN: Record<string, string> = {
  routes: "Route",
  route_verifications: "Route approval",
  fare_rules: "Fare",
  stops: "Stop",
  route_stops: "Route stop",
  route_shapes: "Route geometry",
  route_reports: "Report",
  landmarks: "Landmark",
};

const REPORT_STATUS_LABEL: Record<string, string> = { new: "pending", reviewing: "reviewing", resolved: "resolved", rejected: "rejected" };

const str = (v: unknown) => (typeof v === "string" ? v : null);

/** What happened, in words, derived from the stored row and the columns that changed. */
export function describeAudit(e: AuditEntry): { label: string; subject: string | null; significant: boolean } {
  const after = e.changes ?? {};
  const before = e.previous ?? {};
  const noun = ENTITY_NOUN[e.entity_type] ?? e.entity_type;
  const subject = str(after.name) ?? str(after.code) ?? null;
  const verb = e.action === "insert" ? "created" : e.action === "delete" ? "deleted" : "updated";
  const result = (label: string, significant: boolean) => ({ label, subject, significant });

  if (e.entity_type === "route_verifications") return result("Route approved (verified)", true);

  if (e.entity_type === "routes") {
    if (e.action !== "update") return result(`Route ${verb}`, true);
    if ("status" in before) {
      const to = str(after.status);
      if (to === "inactive") return result("Route deactivated", true);
      if (to === "active") return result("Route activated", true);
      if (to === "draft") return result("Route set back to draft", true);
    }
    if ("verification_status" in before) {
      const to = str(after.verification_status);
      if (to === "verified") return result("Route verified", true);
      if (to === "outdated") return result("Route marked outdated", true);
      if (to === "unverified") return result("Route returned to unverified", true);
    }
    return result("Route edited", true);
  }

  if (e.entity_type === "fare_rules") {
    if (e.action === "insert") return result(`Fare added (${formatAmount(after.amount)})`, true);
    if (e.action === "delete") return result("Fare deleted", true);
    if ("amount" in before) return result(`Fare price changed (${formatAmount(before.amount)} to ${formatAmount(after.amount)})`, true);
    if ("effective_until" in before && after.effective_until) return result(`Fare ended on ${String(after.effective_until)}`, true);
    if ("verification_status" in before) return result(`Fare ${str(after.verification_status) ?? "updated"}`, true);
    return result("Fare edited", true);
  }

  if (e.entity_type === "route_reports") {
    if (e.action === "delete") return result("Report deleted", true);
    if ("status" in before) return result(`Report marked ${REPORT_STATUS_LABEL[str(after.status) ?? ""] ?? str(after.status) ?? "updated"}`, true);
    return result("Report updated", false);
  }

  return result(`${noun} ${verb}`, false);
}

function formatAmount(v: unknown): string {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? formatPeso(n) : "unknown";
}
