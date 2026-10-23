import Link from "next/link";
import { formatDate } from "@/components/admin/admin-ui";
import { ImportWizard } from "@/components/admin/import-wizard";
import { listBatches } from "@/lib/admin/data";
import { requireAdminPage } from "@/lib/admin/session";

export const metadata = { title: "CSV import" };

export default async function AdminImportPage() {
  const ctx = await requireAdminPage();
  if (ctx.status !== "admin") return null;
  let batches: Awaited<ReturnType<typeof listBatches>> = [];
  let historyFailed = false;
  try {
    batches = await listBatches(ctx.supabase);
  } catch (error) {
    console.error("Import history failed", error);
    historyFailed = true;
  }

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">CSV import</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Add stops, routes, ordered stop sequences and fare rules from CSV files. Imports only ever add new records as
          unverified drafts; they never overwrite or verify anything. The format and review procedure are in{" "}
          <code className="rounded bg-muted px-1">docs/ADMIN.md</code>.
        </p>
      </div>

      <ImportWizard />

      <section aria-labelledby="history-heading" className="space-y-3">
        <h2 id="history-heading" className="text-lg font-semibold">Recent imports</h2>
        {historyFailed ? (
          <p className="text-sm text-destructive">The import history could not be loaded.</p>
        ) : batches.length === 0 ? (
          <p className="text-sm text-muted-foreground">No imports yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <caption className="sr-only">Recent import batches</caption>
              <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium">When</th>
                  <th scope="col" className="px-4 py-2 font-medium">Source</th>
                  <th scope="col" className="px-4 py-2 font-medium">Records</th>
                  <th scope="col" className="px-4 py-2 font-medium">Imported by</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {batches.map((b) => {
                  const c = b.counts as Record<string, number>;
                  return (
                    <tr key={b.id}>
                      <td className="px-4 py-3">{formatDate(b.created_at)}</td>
                      <td className="px-4 py-3">
                        <Link href={`/admin/routes?batch=${b.id}`} className="text-link underline-offset-4 hover:underline">{b.source_description}</Link>
                      </td>
                      <td className="px-4 py-3 tabular-nums">{c.stops ?? 0} stops, {c.routes ?? 0} routes, {c.route_stops ?? 0} route stops, {c.fares ?? 0} fares</td>
                      <td className="px-4 py-3"><code className="text-xs">{b.imported_by ?? "unknown"}</code></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
