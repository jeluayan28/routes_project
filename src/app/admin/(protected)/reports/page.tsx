import Link from "next/link";
import { ErrorMessage } from "@/components/common/error-message";
import { formatDate } from "@/components/admin/admin-ui";
import { Pagination } from "@/components/admin/pagination";
import { buttonVariants } from "@/components/ui/button";
import { listReports } from "@/lib/admin/data";
import { PAGE_SIZE, paginate, parsePage } from "@/lib/admin/pagination";
import { REPORT_STATUS_LABEL, REPORT_TYPE_LABEL, REPORT_STATUSES, isOpenReport, parseReportStatus } from "@/lib/admin/reports";
import { requireAdminPage } from "@/lib/admin/session";
import { firstParam } from "@/lib/search-params";
import { cn } from "@/lib/utils";

export const metadata = { title: "Reports" };

export default async function AdminReportsPage({ searchParams }: PageProps<"/admin/reports">) {
  const ctx = await requireAdminPage();
  if (ctx.status !== "admin") return null;
  const params = await searchParams;
  const rawFilter = firstParam(params.status) ?? "";
  const status = parseReportStatus(rawFilter);
  const openOnly = rawFilter === "open";

  let all;
  try {
    all = await listReports(ctx.supabase);
  } catch (error) {
    console.error("Report list failed", error);
    return <ErrorMessage title="Couldn't load reports" message="The reports could not be loaded." />;
  }
  const counts = Object.fromEntries(REPORT_STATUSES.map((s) => [s, all.filter((r) => r.status === s).length]));
  const filtered = all.filter((r) => (status ? r.status === status : openOnly ? isOpenReport(r.status) : true));
  const page = paginate(filtered, parsePage(firstParam(params.page)), PAGE_SIZE);
  const href = (p: number) => {
    const q = new URLSearchParams();
    if (rawFilter) q.set("status", rawFilter);
    if (p > 1) q.set("page", String(p));
    const text = q.toString();
    return `/admin/reports${text ? `?${text}` : ""}`;
  };
  const filters: [string, string][] = [["", "All"], ["open", "Open"], ...REPORT_STATUSES.map((s): [string, string] => [s, `${REPORT_STATUS_LABEL[s]} (${counts[s]})`])];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Public reports</h1>
        <p className="text-sm text-muted-foreground">
          Corrections sent in by the public. Reporter contact details are shown only here, to administrators, and never on the public site. Each status
          change is recorded in the{" "}
          <Link href="/admin/audit?entity=route_reports" className="text-link underline-offset-4 hover:underline">audit log</Link>.
        </p>
      </div>

      <nav aria-label="Filter reports">
        <ul className="flex flex-wrap gap-2">
          {filters.map(([key, label]) => (
            <li key={key}>
              <Link
                href={key === "" ? "/admin/reports" : `/admin/reports?status=${key}`}
                aria-current={rawFilter === key ? "page" : undefined}
                className={cn(
                  "inline-flex h-9 items-center rounded-full border px-3.5 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  rawFilter === key ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-accent",
                )}
              >
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {page.total === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
          {all.length === 0 ? "No reports have been submitted." : "No reports match this filter."}
        </p>
      ) : (
        <ul className="space-y-3">
          {page.items.map((r) => (
            <li key={r.id} className="space-y-2 rounded-xl border bg-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">
                  {REPORT_TYPE_LABEL[r.report_type]}
                  <span className="ml-2 rounded-full border px-2 py-0.5 text-xs font-normal text-muted-foreground">{REPORT_STATUS_LABEL[r.status]}</span>
                </p>
                <p className="text-xs text-muted-foreground">Received {formatDate(r.created_at)}</p>
              </div>
              <p className="whitespace-pre-wrap text-sm">{r.description}</p>
              <p className="text-xs text-muted-foreground">
                {r.route_id && (
                  <>
                    Route:{" "}
                    <Link href={`/admin/routes/${r.route_id}`} className="text-link underline-offset-4 hover:underline">{r.routeName ?? r.route_id}</Link> ·{" "}
                  </>
                )}
                {r.stopName && <>Stop: {r.stopName} · </>}
                Contact (private): {r.reporter_contact?.trim() || "none given"}
              </p>
              {r.resolution_note && <p className="text-xs text-muted-foreground">Resolution note: {r.resolution_note}</p>}
              <Link href={`/admin/reports/${r.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                Inspect and respond<span className="sr-only"> to this report</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Pagination page={page} href={href} />
    </div>
  );
}
