import { VERIFICATION_STALE_AFTER_DAYS, isInsideServiceArea } from "@/lib/constants";

type Status = "unverified" | "verified" | "outdated";

export type DashboardInput = {
  now: Date;
  routes: {
    id: string;
    status: "draft" | "active" | "inactive";
    verification_status: Status;
    last_verified_at: string | null;
    is_sample: boolean;
  }[];
  /** Route ids that have at least one fare rule. */
  routeIdsWithFares: readonly string[];
  /** Route ids with a report that is new or being reviewed. */
  openReportRouteIds: readonly string[];
  stops: {
    id: string;
    latitude: number;
    longitude: number;
    verification_status: Status;
    last_verified_at: string | null;
    is_sample: boolean;
  }[];
  shapes: { route_id: string; verification_status: Status; last_verified_at: string | null }[];
  fares: { route_id: string; verification_status: Status; verified_at: string | null }[];
};

export type ReviewReason = "outdated" | "stale" | "open-report" | "active-unverified";

export type Dashboard = {
  totals: { routes: number; stops: number; sampleRoutes: number };
  draft: string[];
  verified: string[];
  needsReview: { id: string; reasons: ReviewReason[] }[];
  missingFares: string[];
  suspectStops: { id: string; reason: "placeholder" | "outside-area" | "invalid" }[];
  outdated: { routes: string[]; stops: string[]; shapes: number; fares: number };
};

export const REVIEW_REASON_LABEL: Record<ReviewReason, string> = {
  outdated: "Marked outdated",
  stale: `Verified more than ${VERIFICATION_STALE_AFTER_DAYS} days ago`,
  "open-report": "Has an open correction report",
  "active-unverified": "Active but not verified",
};

export function isStale(verifiedAt: string | null, now: Date): boolean {
  if (!verifiedAt) return false;
  const ageMs = now.getTime() - new Date(verifiedAt).getTime();
  return ageMs > VERIFICATION_STALE_AFTER_DAYS * 86_400_000;
}

/**
 * Progress figures for the admin dashboard.
 *
 *  - draft:        status is draft.
 *  - verified:     verified and not stale.
 *  - needsReview:  anything not draft/sample that is outdated, stale, active
 *                  without verification, or has an open report.
 *  - missingFares: any non-sample route with no fare rule at all.
 *  - suspectStops: coordinates that cannot be a real stop in Butuan (0,0,
 *                  non-finite, or well outside the city). The database requires
 *                  coordinates, so "missing" is not possible; these are the
 *                  incomplete/placeholder ones.
 *  - outdated:     verification marked outdated, or verified but stale.
 *
 * Sample records are counted separately and never inflate these lists.
 */
export function computeDashboard(input: DashboardInput): Dashboard {
  const { now } = input;
  const real = input.routes.filter((r) => !r.is_sample);
  const withFares = new Set(input.routeIdsWithFares);
  const withReport = new Set(input.openReportRouteIds);
  const outdatedOrStale = (status: Status, at: string | null) =>
    status === "outdated" || (status === "verified" && isStale(at, now));

  const needsReview: Dashboard["needsReview"] = [];
  for (const r of real) {
    if (r.status === "draft") continue;
    const reasons: ReviewReason[] = [];
    if (r.verification_status === "outdated") reasons.push("outdated");
    if (r.verification_status === "verified" && isStale(r.last_verified_at, now)) reasons.push("stale");
    if (withReport.has(r.id)) reasons.push("open-report");
    if (r.status === "active" && r.verification_status === "unverified") reasons.push("active-unverified");
    if (reasons.length > 0) needsReview.push({ id: r.id, reasons });
  }

  const suspectStops: Dashboard["suspectStops"] = [];
  for (const s of input.stops) {
    if (s.is_sample) continue;
    if (!Number.isFinite(s.latitude) || !Number.isFinite(s.longitude)) suspectStops.push({ id: s.id, reason: "invalid" });
    else if (s.latitude === 0 && s.longitude === 0) suspectStops.push({ id: s.id, reason: "placeholder" });
    else if (!isInsideServiceArea({ lat: s.latitude, lng: s.longitude })) suspectStops.push({ id: s.id, reason: "outside-area" });
  }

  return {
    totals: { routes: real.length, stops: input.stops.filter((s) => !s.is_sample).length, sampleRoutes: input.routes.length - real.length },
    draft: real.filter((r) => r.status === "draft").map((r) => r.id),
    verified: real.filter((r) => r.verification_status === "verified" && !isStale(r.last_verified_at, now)).map((r) => r.id),
    needsReview,
    missingFares: real.filter((r) => !withFares.has(r.id)).map((r) => r.id),
    suspectStops,
    outdated: {
      routes: real.filter((r) => outdatedOrStale(r.verification_status, r.last_verified_at)).map((r) => r.id),
      stops: input.stops.filter((s) => !s.is_sample && outdatedOrStale(s.verification_status, s.last_verified_at)).map((s) => s.id),
      shapes: input.shapes.filter((s) => outdatedOrStale(s.verification_status, s.last_verified_at)).length,
      fares: input.fares.filter((f) => outdatedOrStale(f.verification_status, f.verified_at)).length,
    },
  };
}

/** Whether a route is shown to the public, and if not, why. */
export function publicStatus(route: {
  status: "draft" | "active" | "inactive";
  verification_status: Status;
  last_verified_at?: string | null;
  is_sample: boolean;
}, now = new Date()): { public: boolean; reason: string } {
  if (route.is_sample) return { public: false, reason: "Sample data. It can never be published." };
  if (route.status !== "active") return { public: false, reason: `Not public: the route is ${route.status}.` };
  if (route.verification_status !== "verified") {
    return { public: false, reason: `Not public: verification status is ${route.verification_status}.` };
  }
  if (isStale(route.last_verified_at ?? null, now)) {
    return { public: true, reason: `Public, but last verified more than ${VERIFICATION_STALE_AFTER_DAYS} days ago. Re-verify it.` };
  }
  return { public: true, reason: "Public: active and verified." };
}
