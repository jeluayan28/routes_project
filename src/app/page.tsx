import Link from "next/link";
import { Suspense } from "react";
import { ArrowRight, Banknote, MapPinOff, Route as RouteIcon } from "lucide-react";
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
          <Link href="/explore" className="inline-flex items-center gap-1 text-sm font-medium text-link underline-offset-4 hover:underline">
            Open full map <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        </div>
        <MapPreview routes={result.data} />
      </section>

      <section aria-labelledby="featured-heading" className="space-y-3">
        <div className="flex items-end justify-between gap-4">
          <h2 id="featured-heading" className="text-xl font-semibold">Route directory</h2>
          {featured.length > 0 && (
            <Link href="/explore" className="inline-flex items-center gap-1 text-sm font-medium text-link underline-offset-4 hover:underline">
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

/** Drop your own photo at public/pics/hero.jpg. Until then the navy background shows. */
const HERO_IMAGE = "/pics/hero.jpg";

const HERO_LINKS = [
  { href: "/explore", title: "Routes & Map", icon: RouteIcon },
  { href: "/fares", title: "Fare Guide", icon: Banknote },
] as const;

function Hero() {
  return (
    <section aria-labelledby="hero-heading" className="on-navy overflow-hidden">
      <div className="mx-auto grid w-full max-w-6xl lg:min-h-[30rem] lg:grid-cols-[1.15fr_1fr]">
        <div
          className="relative flex min-h-64 items-center bg-cover bg-center px-6 py-10 sm:px-10 lg:rounded-r-[45%] lg:px-12"
          style={{ backgroundImage: `linear-gradient(90deg, rgb(23 45 70 / 0.88), rgb(23 45 70 / 0.35)), url(${HERO_IMAGE})` }}
        >
          <div className="space-y-4">
            <h1 id="hero-heading" className="text-5xl leading-[1.05] font-semibold tracking-tight sm:text-6xl">
              Find your way
              <br />
              around Butuan.
            </h1>
            <p className="text-sm font-medium tracking-[0.3em] uppercase">Jeepney &amp; multicab routes</p>
            <p className="max-w-sm text-sm text-muted-foreground">Routes, stops and fares. Free, with no account needed.</p>
          </div>
        </div>

        <div className="space-y-4 px-4 py-8 sm:px-8 lg:py-10">
          <TripSearchForm layout="hero" />
          <ul className="grid grid-cols-2 gap-3">
            {HERO_LINKS.map(({ href, title, icon: Icon }) => (
              <li key={href}>
                <Link
                  href={href}
                  className="flex h-full flex-col gap-1 rounded-xl border border-white/40 p-3 text-sm font-semibold outline-none hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="flex items-center gap-2">
                    <Icon aria-hidden="true" className="size-4" />
                    {title}
                  </span>
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-gold">
                    VIEW HERE <ArrowRight aria-hidden="true" className="size-3" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="bg-black/25 py-4 text-center text-sm">
        All Butuan <Link href="/explore" className="font-semibold text-gold underline-offset-4 hover:underline">Transit Routes</Link>
      </div>
    </section>
  );
}

export default function HomePage() {
  return (
    <>
      <Hero />
      <div className="mx-auto w-full max-w-6xl space-y-10 px-4 py-8 sm:py-12">

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
    </>
  );
}
