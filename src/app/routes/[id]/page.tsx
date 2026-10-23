import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { ErrorMessage } from "@/components/common/error-message";
import { SampleDataBanner } from "@/components/common/sample-data-banner";
import { RouteMapLazy } from "@/components/map/route-map-lazy";
import { RouteDetailsPanel } from "@/components/routes/route-details-panel";
import { Skeleton } from "@/components/ui/skeleton";
import { getRouteById } from "@/lib/data/routes";

export const metadata: Metadata = { title: "Route details" };

async function RouteContent({ params }: { params: PageProps<"/routes/[id]">["params"] }) {
  const { id } = await params;
  const result = await getRouteById(id);

  if (result.status === "error") {
    return <ErrorMessage title="Couldn't load this route" message={result.message} />;
  }
  const route = result.data;
  if (!route) notFound();

  return (
    <div className="space-y-4">
      <SampleDataBanner source={result.source} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,26rem)_1fr]">
        <div className="rounded-2xl border bg-card p-5 shadow-xs">
          <RouteDetailsPanel route={route} headingLevel="h1" />
        </div>
        <div className="isolate order-first h-80 overflow-hidden rounded-2xl border shadow-xs lg:sticky lg:top-20 lg:order-none lg:h-[calc(100svh-7rem)]">
          <RouteMapLazy
            routes={[route]}
            selectedId={route.id}
            label={`Map highlighting route ${route.code}`}
            className="h-full w-full"
          />
        </div>
      </div>
    </div>
  );
}

function RouteSkeleton() {
  return (
    <div role="status" aria-label="Loading route" className="grid gap-6 lg:grid-cols-[minmax(0,26rem)_1fr]">
      <div className="space-y-4 rounded-2xl border bg-card p-5">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
      <Skeleton className="order-first h-80 rounded-2xl lg:order-none lg:h-[28rem]" />
    </div>
  );
}

export default function RoutePage({ params }: PageProps<"/routes/[id]">) {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-6">
      <Link
        href="/explore"
        className="inline-flex items-center gap-1 rounded text-sm font-medium text-link outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Back to all routes
      </Link>
      <Suspense fallback={<RouteSkeleton />}>
        <RouteContent params={params} />
      </Suspense>
    </div>
  );
}
