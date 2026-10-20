import Link from "next/link";
import { Suspense } from "react";
import { ArrowRight, MapPinOff } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorMessage } from "@/components/common/error-message";
import { SampleDataBanner } from "@/components/common/sample-data-banner";
import { VerificationNotice } from "@/components/common/verification-notice";
import { MapPreview } from "@/components/map/map-preview";
import { RouteCard } from "@/components/routes/route-card";
import { RouteListSkeleton } from "@/components/routes/route-list-skeleton";
import { TripSearchForm } from "@/components/search/trip-search-form";
import { Skeleton } from "@/components/ui/skeleton";
import { getRoutes } from "@/lib/data/routes";

const STEPS = [
  { title: "Enter your trip", body: "Tell us where you are starting and where you want to go." },
  { title: "Browse routes", body: "Compare jeepney and multicab routes, their stops, and direction on the map." },
  { title: "Check the details", body: "See fares and when they were last verified before you ride." },
];

async function HomeMapAndRoutes() {
  const result = await getRoutes();
  if (result.status === "error") {
    return <ErrorMessage title="Couldn't load routes" message={result.message} />;
  }
  const featured = result.data.slice(0, 3);

  return (
    <>
      <SampleDataBanner source={result.source} />

      <section aria-labelledby="map-heading" className="space-y-3">
        <div className="flex items-end justify-between gap-4">
          <h2 id="map-heading" className="text-xl font-semibold">Map</h2>
          <Link href="/explore" className="inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline">
            Open full map <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        </div>
        <MapPreview routes={result.data} />
      </section>

      <section aria-labelledby="featured-heading" className="space-y-3">
        <div className="flex items-end justify-between gap-4">
          <h2 id="featured-heading" className="text-xl font-semibold">Route directory</h2>
          {featured.length > 0 && (
            <Link href="/explore" className="inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline">
              All routes <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          )}
        </div>
        {featured.length === 0 ? (
          <EmptyState
            icon={MapPinOff}
            title="No routes published yet"
            description="Featured routes will appear here once verified local transport data has been added."
          />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {featured.map((route) => (
              <li key={route.id}>
                <RouteCard route={route} className="h-full" />
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function HomeSkeleton() {
  return (
    <div className="space-y-8">
      <Skeleton role="status" aria-label="Loading map" className="h-72 rounded-2xl sm:h-96" />
      <RouteListSkeleton />
    </div>
  );
}

export default function HomePage() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-10 px-4 py-8 sm:py-12">
      <section aria-labelledby="hero-heading" className="mx-auto max-w-3xl space-y-5">
        <div className="space-y-3 text-center">
          <h1 id="hero-heading" className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Find your way around Butuan.
          </h1>
          <p className="text-muted-foreground">
            Jeepney and multicab routes, stops, and fares. Free, with no account needed.
          </p>
        </div>
        <TripSearchForm />
      </section>

      <Suspense fallback={<HomeSkeleton />}>
        <HomeMapAndRoutes />
      </Suspense>

      <section aria-labelledby="how-heading" className="space-y-4">
        <h2 id="how-heading" className="text-xl font-semibold">How it works</h2>
        <ol className="grid gap-4 sm:grid-cols-3">
          {STEPS.map((step, i) => (
            <li key={step.title} className="rounded-2xl border bg-card p-5 shadow-xs">
              <span className="flex size-7 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                {i + 1}
              </span>
              <h3 className="mt-3 font-semibold">{step.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <VerificationNotice />
    </div>
  );
}
