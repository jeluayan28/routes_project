import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
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
  description: "Find verified jeepney and multicab routes between two places in Butuan City, with transfers and fares where verified.",
};

async function SearchContent({ searchParams }: { searchParams: PageProps<"/search">["searchParams"] }) {
  const parsed = parseTripParams(await searchParams);

  if (parsed.status === "empty") {
    return (
      <>
        <TripSearchForm />
        <p className="text-sm text-muted-foreground">Enter where you are starting and where you are going.</p>
      </>
    );
  }
  if (parsed.status === "invalid") {
    return (
      <>
        <TripSearchForm />
        <ErrorMessage title="Check your search" message={parsed.message} />
      </>
    );
  }

  // The search depends on today's date (fares have effective dates), so it runs per request.
  await connection();
  const response = await runTripSearch(parsed.value, { loadData: loadSearchData, geocoder: geocoderFromEnv() });
  return (
    <>
      <TripSearchForm initial={parsed.value} />
      <TripResults response={response} params={parsed.value} />
    </>
  );
}

function SearchSkeleton() {
  return (
    <div role="status" aria-label="Searching routes" className="space-y-4">
      <Skeleton className="h-52 w-full rounded-2xl" />
      <Skeleton className="h-40 w-full rounded-2xl" />
    </div>
  );
}

export default function SearchPage({ searchParams }: PageProps<"/search">) {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Find a route</h1>
      <Suspense fallback={<SearchSkeleton />}>
        <SearchContent searchParams={searchParams} />
      </Suspense>
      <VerificationNotice />
    </div>
  );
}
