import Link from "next/link";
import { ErrorMessage } from "@/components/common/error-message";
import { RouteBadges, formatDate } from "@/components/admin/admin-ui";
import { Pagination } from "@/components/admin/pagination";
import { paginate, parsePage } from "@/lib/admin/pagination";
import { buttonVariants } from "@/components/ui/button";
import { REVIEW_REASON_LABEL } from "@/lib/admin/dashboard";
import { listRoutes, loadDashboard } from "@/lib/admin/data";
import { requireAdminPage } from "@/lib/admin/session";
import { VEHICLE_LABEL } from "@/lib/format";
import { firstParam } from "@/lib/search-params";
import { cn } from "@/lib/utils";

export const metadata = { title: "Routes" };

const FILTERS = [
  ["all", "All"],
  ["active", "Active"],
  ["draft", "Draft"],
  ["verified", "Verified"],
  ["review", "Needs review"],
  ["nofares", "Missing fares"],
  ["farereview", "Fares to verify"],
  ["outdated", "Outdated"],
  ["sample", "Sample"],
] as const;

export default async function AdminRoutesPage({ searchParams }: PageProps<"/admin/routes">) {
  const ctx = await requireAdminPage();
  if (ctx.status !== "admin") return null;
  const params = await searchParams;
  const filter = FILTERS.find(([key]) => key === firstParam(params.filter))?.[0] ?? "all";
  const batch = firstParam(params.batch);
  const requestedPage = parsePage(firstParam(params.page));

  let routes, dashboard;
  try {
    [routes, { dashboard }] = await Promise.all([listRoutes(ctx.supabase), loadDashboard(ctx.supabase)]);
  } catch (error) {
    console.error("Route list failed", error);
    return <ErrorMessage title="Couldn't load routes" message="The route list could not be loaded." />;
  }

  const ids = {
    draft: new Set(dashboard.draft),
    verified: new Set(dashboard.verified),
    review: new Map(dashboard.needsReview.map((r) => [r.id, r.reasons])),
    nofares: new Set(dashboard.missingFares),
    farereview: new Set(dashboard.fareReviewRoutes),
    outdated: new Set(dashboard.outdated.routes),
  };
  const shown = routes.filter((r) => {
    if (batch && r.import_batch_id !== batch) return false;
    switch (filter) {
      case "active": return r.status === "active" && !r.is_sample;
      case "draft": return ids.draft.has(r.id);
      case "farereview": return ids.farereview.has(r.id);
      case "verified": return ids.verified.has(r.id);
      case "review": return ids.review.has(r.id);
      case "nofares": return ids.nofares.has(r.id);
      case "outdated": return ids.outdated.has(r.id);
      case "sample": return r.is_sample;
      default: return true;
    }
  });

  const page = paginate(shown, requestedPage);
  const pageHref = (p: number) => {
    const q = new URLSearchParams();
    if (filter !== "all") q.set("filter", filter);
    if (batch) q.set("batch", batch);
    if (p > 1) q.set("page", String(p));
    const text = q.toString();
    return `/admin/routes${text ? `?${text}` : ""}`;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Routes</h1>
        <Link href="/admin/routes/new" className={buttonVariants()}>New route</Link>
      </div>

      <nav aria-label="Filter routes">
        <ul className="flex flex-wrap gap-2">
          {FILTERS.map(([key, label]) => (
            <li key={key}>
              <Link
                href={key === "all" ? "/admin/routes" : `/admin/routes?filter=${key}`}
                aria-current={filter === key ? "page" : undefined}
                className={cn(
                  "inline-flex h-9 items-center rounded-full border px-3.5 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  filter === key ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-accent",
                )}
              >
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {batch && (
        <p className="text-sm text-muted-foreground">
          Showing routes from import batch <code className="rounded bg-muted px-1">{batch}</code>.{" "}
          <Link href="/admin/routes" className="text-primary underline-offset-4 hover:underline">Show all</Link>
        </p>
      )}

      <p aria-live="polite" className="text-sm text-muted-foreground">{shown.length} {shown.length === 1 ? "route" : "routes"}</p>

      {shown.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
          {routes.length === 0 ? "No routes yet. Create a draft route or import a CSV." : "No routes match this filter."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full min-w-[44rem] text-left text-sm">
            <caption className="sr-only">Routes with their status and verification</caption>
            <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">Route</th>
                <th scope="col" className="px-4 py-2 font-medium">State</th>
                <th scope="col" className="px-4 py-2 font-medium">Stops</th>
                <th scope="col" className="px-4 py-2 font-medium">Fares</th>
                <th scope="col" className="px-4 py-2 font-medium">Last verified</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {page.items.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="px-4 py-3">
                    <Link href={`/admin/routes/${r.id}`} className="font-medium text-primary underline-offset-4 hover:underline">
                      {r.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {VEHICLE_LABEL[r.transport_type]}{r.code ? ` · ${r.code}` : ""}{r.import_batch_id ? " · imported" : ""}
                    </p>
                    {ids.review.get(r.id) && (
                      <p className="mt-1 text-xs text-amber-800">{ids.review.get(r.id)!.map((x) => REVIEW_REASON_LABEL[x]).join(" · ")}</p>
                    )}
                  </td>
                  <td className="px-4 py-3"><RouteBadges route={r} /></td>
                  <td className="px-4 py-3 tabular-nums">{r.stopCount}</td>
                  <td className="px-4 py-3 tabular-nums">{r.fareCount === 0 ? <span className="text-amber-800">none</span> : r.fareCount}</td>
                  <td className="px-4 py-3">{formatDate(r.last_verified_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={page} href={pageHref} />
    </div>
  );
}
