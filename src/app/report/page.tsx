import type { Metadata } from "next";
import { Suspense } from "react";
import { ErrorMessage } from "@/components/common/error-message";
import { ReportForm, type ReportRoute } from "@/components/reports/report-form";
import { Skeleton } from "@/components/ui/skeleton";
import { getRoutes } from "@/lib/data/routes";
import { PUBLIC_REPORT_TYPES, type PublicReportType } from "@/lib/reports/schema";
import { firstParam } from "@/lib/search-params";
import { z } from "zod";

export const metadata: Metadata = {
  title: "Report incorrect information",
  description: "Tell us about a wrong route, stop, direction or fare. No account needed.",
};

async function ReportContent({ searchParams }: { searchParams: PageProps<"/report">["searchParams"] }) {
  const params = await searchParams;
  const result = await getRoutes();
  if (result.status === "error") {
    return <ErrorMessage title="Reporting is unavailable" message="We can't load the list of routes right now, so reports can't be sent. Please try again later." />;
  }

  const routes: ReportRoute[] = result.data.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    stops: [...new Map(r.directions.flatMap((d) => d.stops).map((s) => [s.id, { id: s.id, name: s.name }])).values()],
  }));

  // Links from other pages pre-fill the form. Anything that is not a known value is ignored.
  const type = PUBLIC_REPORT_TYPES.find((t) => t === firstParam(params.type)) as PublicReportType | undefined;
  const routeId = routes.find((r) => r.id === firstParam(params.route))?.id;
  const stopId = routes.flatMap((r) => r.stops).find((s) => s.id === firstParam(params.stop))?.id;
  const direction = z.enum(["outbound", "inbound"]).safeParse(firstParam(params.direction)).data;

  return <ReportForm routes={routes} initial={{ type, routeId, stopId, direction }} />;
}

export default function ReportPage({ searchParams }: PageProps<"/report">) {
  return (
    <div className="mx-auto w-full max-w-xl space-y-6 px-4 py-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Report incorrect information</h1>
        <p className="text-muted-foreground">
          Spotted a wrong route, stop, direction or fare, or something missing? Tell us. You don&apos;t need an account. A report is checked by an
          administrator before anything changes, and it is never shown to other visitors as fact.
        </p>
      </header>
      <Suspense fallback={<Skeleton className="h-96 w-full rounded-2xl" />}>
        <ReportContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
