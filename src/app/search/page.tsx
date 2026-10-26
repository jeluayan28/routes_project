import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";
import { ErrorMessage } from "@/components/common/error-message";
import { VerificationNotice } from "@/components/common/verification-notice";
import { TripResults } from "@/components/search/trip-results";
import { TripSearchForm } from "@/components/search/trip-search-form";
import { Skeleton } from "@/components/ui/skeleton";
import { geocoderFromEnv } from "@/lib/search/geocoder";
import { loadSearchData } from "@/lib/search/load";
import { parseTripParams } from "@/lib/search/params";
import { runTripSearch } from "@/lib/search/service";

export const metadata: Metadata = {
  title: "Find a route",
  description: "Find verified minibus and multicab routes between two places in Butuan City, with transfers and fares where verified.",
};

/** Centred column for states with no results to show beside a map. */
function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-xl space-y-6 px-4 py-6 sm:py-10">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Find a route</h1>
        <p className="text-muted-foreground">Enter where you are starting and where you are going.</p>
      </div>
      {children}
      <VerificationNotice />
    </div>
  );
}

async function SearchContent({ searchParams }: { searchParams: PageProps<"/search">["searchParams"] }) {
  const parsed = parseTripParams(await searchParams);

  if (parsed.status === "empty") {
    return (
      <Centered>
        <div className="rounded-2xl border bg-card p-4 shadow-xs sm:p-5">
          <TripSearchForm layout="panel" />
        </div>
      </Centered>
    );
  }
  if (parsed.status === "invalid") {
    return (
      <Centered>
        <div className="rounded-2xl border bg-card p-4 shadow-xs sm:p-5">
          <TripSearchForm layout="panel" />
        </div>
        <ErrorMessage title="Check your search" message={parsed.message} />
      </Centered>
    );
  }

  // The search depends on today's date (fares have effective dates), so it runs per request.
  await connection();
  const response = await runTripSearch(parsed.value, { loadData: loadSearchData, geocoder: geocoderFromEnv() });
  return <TripResults response={response} params={parsed.value} form={<TripSearchForm layout="panel" initial={parsed.value} />} />;
}

function SearchSkeleton() {
  return (
    <div role="status" aria-label="Searching routes" className="flex flex-col lg:h-[calc(100svh-3.5rem)] lg:flex-row">
      <div className="space-y-4 p-4 lg:w-[28rem] lg:border-r">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-44 w-full rounded-xl" />
      </div>
      <Skeleton className="hidden flex-1 rounded-none lg:block" />
    </div>
  );
}

export default function SearchPage({ searchParams }: PageProps<"/search">) {
  return (
    <Suspense fallback={<SearchSkeleton />}>
      <SearchContent searchParams={searchParams} />
    </Suspense>
  );
}
