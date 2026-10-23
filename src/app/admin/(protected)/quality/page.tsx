import Link from "next/link";
import { ErrorMessage } from "@/components/common/error-message";
import { Notice } from "@/components/admin/admin-ui";
import { loadQuality } from "@/lib/admin/data";
import { FLAG_LABEL, ROUTE_FLAGS, STOP_FLAGS, computeQuality } from "@/lib/admin/quality";
import { requireAdminPage } from "@/lib/admin/session";
import { VERIFICATION_STALE_AFTER_DAYS } from "@/lib/constants";

export const metadata = { title: "Data quality" };

export default async function AdminQualityPage() {
  const ctx = await requireAdminPage();
  if (ctx.status !== "admin") return null;

  let report;
  try {
    report = computeQuality(await loadQuality(ctx.supabase));
  } catch (error) {
    console.error("Data quality failed", error);
    return <ErrorMessage title="Couldn't load data quality" message="The checks could not be run. Nothing has been changed." />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Data quality</h1>
        <p className="text-sm text-muted-foreground">
          Where the records are not good enough to rely on. Verification older than {VERIFICATION_STALE_AFTER_DAYS} days counts as out of date (set
          NEXT_PUBLIC_VERIFICATION_STALE_DAYS to change this). Sample data is never listed.
        </p>
      </div>

      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {[...ROUTE_FLAGS, ...STOP_FLAGS].filter((f, i, all) => all.indexOf(f) === i).map((f) => (
          <li key={f} className="rounded-xl border bg-card p-3">
            <p className="text-2xl font-semibold">{report.counts[f]}</p>
            <p className="text-xs text-muted-foreground">{FLAG_LABEL[f]}{STOP_FLAGS.includes(f as never) && ROUTE_FLAGS.includes(f as never) ? " (routes and stops)" : ""}</p>
          </li>
        ))}
      </ul>

      {report.routes.length === 0 && report.stops.length === 0 && <Notice tone="success">No problems found.</Notice>}

      {report.routes.length > 0 && (
        <section aria-labelledby="q-routes" className="space-y-2">
          <h2 id="q-routes" className="font-semibold">Routes ({report.routes.length})</h2>
          <ul className="divide-y rounded-xl border bg-card">
            {report.routes.map((r) => (
              <li key={r.id} className="space-y-1 p-3 text-sm">
                <Link href={`/admin/routes/${r.id}`} className="font-medium text-link underline-offset-4 hover:underline">
                  {r.code ? `${r.code} · ` : ""}{r.name}
                </Link>
                <span className="ml-2 text-xs text-muted-foreground">{r.status}</span>
                <ul className="flex flex-wrap gap-1.5">
                  {r.flags.map((f) => <li key={f} className="rounded-full border border-amber-600/40 bg-amber-50 px-2 py-0.5 text-xs text-amber-900">{FLAG_LABEL[f]}</li>)}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      )}

      {report.stops.length > 0 && (
        <section aria-labelledby="q-stops" className="space-y-2">
          <h2 id="q-stops" className="font-semibold">Stops ({report.stops.length})</h2>
          <ul className="divide-y rounded-xl border bg-card">
            {report.stops.map((s) => (
              <li key={s.id} className="space-y-1 p-3 text-sm">
                <Link href={`/admin/stops?q=${encodeURIComponent(s.name)}`} className="font-medium text-link underline-offset-4 hover:underline">{s.name}</Link>
                {s.detail && <span className="ml-2 text-xs text-muted-foreground">{s.detail}</span>}
                <ul className="flex flex-wrap gap-1.5">
                  {s.flags.map((f) => <li key={f} className="rounded-full border border-amber-600/40 bg-amber-50 px-2 py-0.5 text-xs text-amber-900">{FLAG_LABEL[f]}</li>)}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
