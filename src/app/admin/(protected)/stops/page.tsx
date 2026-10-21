import Link from "next/link";
import { ErrorMessage } from "@/components/common/error-message";
import { StopEditList } from "@/components/admin/stop-edit-list";
import { loadDashboard } from "@/lib/admin/data";
import { requireAdminPage } from "@/lib/admin/session";
import { firstParam } from "@/lib/search-params";
import { cn } from "@/lib/utils";

export const metadata = { title: "Stops" };

const REASON_LABEL = { placeholder: "Placeholder coordinates (0, 0)", "outside-area": "Far outside Butuan City", invalid: "Invalid coordinates" } as const;

export default async function AdminStopsPage({ searchParams }: PageProps<"/admin/stops">) {
  const ctx = await requireAdminPage();
  if (ctx.status !== "admin") return null;
  const params = await searchParams;
  const suspectOnly = firstParam(params.filter) === "suspect";
  const q = (firstParam(params.q) ?? "").trim().slice(0, 100).toLowerCase();

  let loaded;
  try {
    loaded = await loadDashboard(ctx.supabase);
  } catch (error) {
    console.error("Stops failed", error);
    return <ErrorMessage title="Couldn't load stops" message="The stop list could not be loaded." />;
  }
  const reasons = new Map(loaded.dashboard.suspectStops.map((s) => [s.id, REASON_LABEL[s.reason]]));
  const stops = loaded.stops
    .filter((s) => (!suspectOnly || reasons.has(s.id)) && (!q || s.name.toLowerCase().includes(q)))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 200);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Stops</h1>
      <p className="text-sm text-muted-foreground">
        Stops are created in the route editor or by CSV import. Fix a wrong location here; a verified stop that changes goes back to unverified, along with every route that uses it.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {[["", "All stops"], ["suspect", "Incomplete coordinates"]].map(([key, label]) => (
          <Link
            key={key}
            href={key ? `/admin/stops?filter=${key}` : "/admin/stops"}
            aria-current={(key === "suspect") === suspectOnly ? "page" : undefined}
            className={cn(
              "inline-flex h-9 items-center rounded-full border px-3.5 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring",
              (key === "suspect") === suspectOnly ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-accent",
            )}
          >
            {label}
          </Link>
        ))}
        <form className="ml-auto" role="search">
          {suspectOnly && <input type="hidden" name="filter" value="suspect" />}
          <input
            type="search" name="q" defaultValue={q} placeholder="Search by name" aria-label="Search stops by name"
            className="h-9 w-56 rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </form>
      </div>
      <p aria-live="polite" className="text-sm text-muted-foreground">
        {stops.length}{stops.length === 200 ? "+" : ""} {stops.length === 1 ? "stop" : "stops"}
      </p>
      <StopEditList
        stops={stops.map((s) => ({
          id: s.id, name: s.name, latitude: s.latitude, longitude: s.longitude, barangay: s.barangay ?? "",
          landmark: s.landmark_description ?? "", pickup: s.pickup_allowed, dropoff: s.dropoff_allowed,
          status: s.verification_status, isSample: s.is_sample, problem: reasons.get(s.id) ?? null,
        }))}
      />
    </div>
  );
}
