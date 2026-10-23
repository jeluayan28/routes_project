import { publicStatus } from "@/lib/admin/dashboard";
import { formatPeso } from "@/lib/format";

export type InspectionInput = {
  today: string; // YYYY-MM-DD, Asia/Manila
  report: { report_type: string; direction: "outbound" | "inbound" | null; route_id: string | null; stop_id: string | null };
  route: {
    id: string; name: string; code: string | null; status: "draft" | "active" | "inactive"; verification_status: "unverified" | "verified" | "outdated";
    last_verified_at: string | null; is_sample: boolean; deactivation_reason: string | null;
  } | null;
  routeStops: { direction: "outbound" | "inbound"; stop_order: number; name: string }[];
  shapes: { direction: "outbound" | "inbound"; verification_status: string }[];
  fares: { passenger_type: string; amount: number; effective_from: string; effective_until: string | null; verification_status: string; source_description: string | null; from_stop_id: string | null }[];
  stop: {
    id: string; name: string; latitude: number; longitude: number; verification_status: string; pickup_allowed: boolean; dropoff_allowed: boolean; last_verified_at: string | null;
  } | null;
  stopRouteCount: number;
  /** Other reports still open for the same route or stop. */
  otherOpenReports: number;
};

export type Fact = { label: string; value: string; warn?: boolean };
export type Inspection = {
  /** What the record says now, to compare against the claim. */
  facts: Fact[];
  /** Things worth an administrator's attention. */
  concerns: string[];
  links: { href: string; label: string }[];
};

const DIRECTION_LABEL = { outbound: "Outbound", inbound: "Inbound" } as const;
const day = (iso: string) => iso.slice(0, 10);

/**
 * Lays out what the database currently holds about the thing a report is about,
 * so an administrator can compare the claim with the record. It only reads: a
 * report is a claim, and acting on it is a separate, deliberate edit.
 */
export function inspectReport(i: InspectionInput): Inspection {
  const facts: Fact[] = [];
  const concerns: string[] = [];
  const links: Inspection["links"] = [];

  if (i.report.route_id && !i.route) {
    concerns.push("The route this report refers to no longer exists.");
  }

  if (i.route) {
    const r = i.route;
    const pub = publicStatus(r);
    links.push({ href: `/admin/routes/${r.id}`, label: "Open the route" }, { href: `/admin/routes/${r.id}?tab=stops`, label: "Edit stops" }, { href: `/admin/routes/${r.id}?tab=fares`, label: "Edit fares" }, { href: `/admin/routes/${r.id}?tab=verify`, label: "Verify or deactivate" });
    facts.push(
      { label: "Route", value: `${r.code ? `${r.code} · ` : ""}${r.name}` },
      { label: "Shown to the public", value: pub.public ? "Yes" : "No", warn: !pub.public },
      { label: "Verification", value: `${r.verification_status}${r.last_verified_at ? `, last verified ${day(r.last_verified_at)}` : ", never verified"}`, warn: r.verification_status !== "verified" },
    );
    if (r.status === "inactive" && r.deactivation_reason) facts.push({ label: "Deactivated because", value: r.deactivation_reason });

    for (const dir of ["outbound", "inbound"] as const) {
      const stops = i.routeStops.filter((s) => s.direction === dir).sort((a, b) => a.stop_order - b.stop_order);
      if (stops.length === 0 && dir === "inbound") continue;
      const shape = i.shapes.filter((s) => s.direction === dir);
      const highlight = i.report.direction === dir;
      facts.push({
        label: `${DIRECTION_LABEL[dir]} direction${highlight ? " (reported)" : ""}`,
        value: stops.length === 0 ? "No stops recorded" : `${stops.length} stops, ${stops[0].name} to ${stops[stops.length - 1].name}; geometry ${shape.length === 0 ? "not recorded" : shape.every((s) => s.verification_status === "verified") ? "verified" : "recorded, not verified"}`,
        warn: stops.length < 2,
      });
    }

    const inForce = i.fares.filter((f) => f.effective_from <= i.today && (f.effective_until === null || f.effective_until >= i.today));
    if (inForce.length === 0) {
      facts.push({ label: "Fares in force today", value: i.fares.length === 0 ? "None recorded" : "None (all expired or not started)", warn: true });
    } else {
      for (const f of inForce) {
        facts.push({
          label: `${f.passenger_type[0].toUpperCase()}${f.passenger_type.slice(1)} fare${f.from_stop_id ? " (stop to stop)" : ""}`,
          value: `${formatPeso(Number(f.amount))}, ${f.verification_status}${f.source_description ? `, source: ${f.source_description}` : ", no source recorded"}`,
          warn: f.verification_status !== "verified",
        });
      }
    }
  }

  if (i.stop) {
    const s = i.stop;
    links.push({ href: `/admin/stops?q=${encodeURIComponent(s.name)}`, label: "Open the stop" });
    facts.push(
      { label: "Stop", value: s.name },
      { label: "Location", value: `${s.latitude}, ${s.longitude}` },
      { label: "Verification", value: `${s.verification_status}${s.last_verified_at ? `, last verified ${day(s.last_verified_at)}` : ""}`, warn: s.verification_status !== "verified" },
      { label: "Boarding / getting off", value: `${s.pickup_allowed ? "boarding allowed" : "no boarding"}, ${s.dropoff_allowed ? "drop-off allowed" : "no drop-off"}` },
      { label: "Used by", value: `${i.stopRouteCount} ${i.stopRouteCount === 1 ? "route" : "routes"}` },
    );
  } else if (i.report.stop_id) {
    concerns.push("The stop this report refers to no longer exists.");
  }

  if (!i.route && !i.stop && !i.report.route_id && !i.report.stop_id) {
    concerns.push("This report doesn't point at a specific route or stop. Search the records yourself, or ask the reporter if they left contact details.");
  }
  if (i.otherOpenReports > 0) {
    concerns.push(`${i.otherOpenReports} other open ${i.otherOpenReports === 1 ? "report refers" : "reports refer"} to the same ${i.stop ? "stop" : "route"}. Several independent reports make the claim more likely, but none is verified.`);
  }
  return { facts, concerns, links };
}
