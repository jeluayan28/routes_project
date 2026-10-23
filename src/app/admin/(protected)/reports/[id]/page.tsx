import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ErrorMessage } from "@/components/common/error-message";
import { Notice, formatDate } from "@/components/admin/admin-ui";
import { ReportStatusControl } from "@/components/admin/report-status-control";
import { buttonVariants } from "@/components/ui/button";
import { loadReportDetail } from "@/lib/admin/data";
import { inspectReport } from "@/lib/admin/report-inspection";
import { REPORT_STATUS_LABEL, REPORT_TYPE_LABEL } from "@/lib/admin/reports";
import { requireAdminPage } from "@/lib/admin/session";

export const metadata = { title: "Inspect report" };

export default async function AdminReportPage({ params }: PageProps<"/admin/reports/[id]">) {
  const ctx = await requireAdminPage();
  if (ctx.status !== "admin") return null;
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  let detail;
  try {
    detail = await loadReportDetail(ctx.supabase, id);
  } catch (error) {
    console.error("Report detail failed", error);
    return <ErrorMessage title="Couldn't load this report" message="The report could not be loaded." />;
  }
  if (!detail) notFound();
  const { report, inspection: input } = detail;
  const inspection = inspectReport(input);

  return (
    <div className="space-y-6">
      <Link href="/admin/reports" className="text-sm font-medium text-primary underline-offset-4 hover:underline">Back to reports</Link>

      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{REPORT_TYPE_LABEL[report.report_type]}</h1>
        <p className="text-sm text-muted-foreground">
          {REPORT_STATUS_LABEL[report.status]} · received {formatDate(report.created_at)}
          {report.direction ? ` · ${report.direction} direction` : ""}
        </p>
      </header>

      <Notice tone="info">This is what a member of the public <strong>claims</strong>. It has not been verified and has changed nothing. Compare it with the record below, correct the record if it is wrong, then record the outcome.</Notice>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="claim-h" className="space-y-3 rounded-xl border bg-card p-4">
          <h2 id="claim-h" className="font-semibold">The report</h2>
          <p className="whitespace-pre-wrap text-sm">{report.description}</p>
          <p className="text-xs text-muted-foreground">Contact (private): {report.reporter_contact?.trim() || "none given"}</p>
        </section>

        <section aria-labelledby="record-h" className="space-y-3 rounded-xl border bg-card p-4">
          <h2 id="record-h" className="font-semibold">What we have on record</h2>
          {inspection.facts.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing specific is linked to this report.</p>
          ) : (
            <dl className="space-y-2 text-sm">
              {inspection.facts.map((f, i) => (
                <div key={`${f.label}${i}`}>
                  <dt className="text-xs text-muted-foreground">{f.label}</dt>
                  <dd className={f.warn ? "font-medium text-amber-800" : undefined}>{f.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>
      </div>

      {inspection.concerns.length > 0 && (
        <Notice tone="warning">
          <ul className="list-disc pl-5">{inspection.concerns.map((c) => <li key={c}>{c}</li>)}</ul>
        </Notice>
      )}

      {inspection.links.length > 0 && (
        <section aria-labelledby="fix-h" className="space-y-2">
          <h2 id="fix-h" className="font-semibold">Correct the record</h2>
          <p className="text-sm text-muted-foreground">Edits are made in the normal editors. They are audited and a verified record returns to unverified until it is verified again.</p>
          <div className="flex flex-wrap gap-2">
            {inspection.links.map((l) => <Link key={l.href} href={l.href} className={buttonVariants({ variant: "outline" })}>{l.label}</Link>)}
          </div>
        </section>
      )}

      <section aria-labelledby="outcome-h" className="space-y-3 rounded-xl border bg-card p-4">
        <h2 id="outcome-h" className="font-semibold">Outcome</h2>
        {report.resolved_at && (
          <p className="text-sm text-muted-foreground">
            {REPORT_STATUS_LABEL[report.status]} on {formatDate(report.resolved_at)}
            {report.resolved_by ? ` by ${report.resolved_by.slice(0, 8)}…` : ""}.
          </p>
        )}
        <ReportStatusControl reportId={report.id} status={report.status} note={report.resolution_note ?? ""} />
      </section>
    </div>
  );
}
