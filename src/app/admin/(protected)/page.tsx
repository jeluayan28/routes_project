import Link from "next/link";
import { ErrorMessage } from "@/components/common/error-message";
import { buttonVariants } from "@/components/ui/button";
import { REVIEW_REASON_LABEL } from "@/lib/admin/dashboard";
import { loadDashboard } from "@/lib/admin/data";
import { requireAdminPage } from "@/lib/admin/session";
import { cn } from "@/lib/utils";

export const metadata = { title: "Dashboard" };

type Card = { title: string; count: number; href: string; description: string; tone?: "warn" };

export default async function AdminDashboardPage() {
  const ctx = await requireAdminPage();
  if (ctx.status !== "admin") return null;

  let loaded;
  try {
    loaded = await loadDashboard(ctx.supabase);
  } catch (error) {
    console.error("Dashboard failed", error);
    return <ErrorMessage title="Couldn't load the dashboard" message="The progress figures could not be loaded. Nothing has been changed." />;
  }
  const { dashboard: d, routes } = loaded;
  const byId = new Map(routes.map((r) => [r.id, r]));

  const cards: Card[] = [
    { title: "Draft routes", count: d.draft.length, href: "/admin/routes?filter=draft", description: "Being prepared. Never shown to the public." },
    { title: "Verified routes", count: d.verified.length, href: "/admin/routes?filter=verified", description: "Verified with a source and date, and not stale. Public only when also active." },
    { title: "Routes needing review", count: d.needsReview.length, href: "/admin/routes?filter=review", description: "Outdated, stale, active without verification, or with an open report.", tone: "warn" },
    { title: "Routes missing fare records", count: d.missingFares.length, href: "/admin/routes?filter=nofares", description: "No fare rule has been recorded at all.", tone: "warn" },
    { title: "Stops with incomplete coordinates", count: d.suspectStops.length, href: "/admin/stops?filter=suspect", description: "Placeholder (0, 0), invalid, or far outside Butuan City.", tone: "warn" },
    { title: "Outdated verification records", count: d.outdated.routes.length + d.outdated.stops.length + d.outdated.shapes + d.outdated.fares, href: "/admin/routes?filter=outdated", description: `${d.outdated.routes.length} routes, ${d.outdated.stops.length} stops, ${d.outdated.shapes} shapes, ${d.outdated.fares} fares.`, tone: "warn" },
  ];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Data progress</h1>
          <p className="text-sm text-muted-foreground">
            {d.totals.routes} routes and {d.totals.stops} stops
            {d.totals.sampleRoutes > 0 && `, plus ${d.totals.sampleRoutes} sample ${d.totals.sampleRoutes === 1 ? "route" : "routes"} (never counted below)`}.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/admin/routes/new" className={buttonVariants()}>New route</Link>
          <Link href="/admin/import" className={buttonVariants({ variant: "outline" })}>Import CSV</Link>
        </div>
      </div>

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <li key={c.title}>
            <Link
              href={c.href}
              className="block h-full rounded-xl border bg-card p-4 shadow-xs outline-none transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <p className="text-sm font-medium text-muted-foreground">{c.title}</p>
              <p className={cn("mt-1 text-3xl font-semibold tabular-nums", c.tone === "warn" && c.count > 0 && "text-amber-700")}>{c.count}</p>
              <p className="mt-1 text-sm text-muted-foreground">{c.description}</p>
            </Link>
          </li>
        ))}
      </ul>

      {d.needsReview.length > 0 && (
        <section aria-labelledby="review-heading" className="space-y-3">
          <h2 id="review-heading" className="text-lg font-semibold">Next to review</h2>
          <ul className="divide-y rounded-xl border bg-card">
            {d.needsReview.slice(0, 8).map(({ id, reasons }) => (
              <li key={id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <Link href={`/admin/routes/${id}?tab=verify`} className="font-medium text-primary underline-offset-4 hover:underline">
                  {byId.get(id)?.name ?? id}
                </Link>
                <span className="text-sm text-muted-foreground">{reasons.map((r) => REVIEW_REASON_LABEL[r]).join(" · ")}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
