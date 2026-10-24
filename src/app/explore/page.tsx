import type { Metadata } from "next";
import { Suspense } from "react";
import { ErrorMessage } from "@/components/common/error-message";
import { ExploreSkeleton } from "@/components/routes/explore-skeleton";
import { ExploreView } from "@/components/routes/explore-view";
import { getRoutes } from "@/lib/data/routes";
import { firstParam, parseTypes } from "@/lib/search-params";

export const metadata: Metadata = {
  title: "Explore Routes",
  description: "Browse minibus and multicab routes in Butuan City on a map.",
};

async function ExploreContent({ searchParams }: { searchParams: PageProps<"/explore">["searchParams"] }) {
  const params = await searchParams;
  const result = await getRoutes();

  if (result.status === "error") {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10">
        <ErrorMessage title="Couldn't load routes" message={result.message} />
      </div>
    );
  }

  const from = firstParam(params.from)?.trim().slice(0, 100);
  const to = firstParam(params.to)?.trim().slice(0, 100);

  return (
    <ExploreView
      routes={result.data}
      source={result.source}
      initialQuery={firstParam(params.q)?.slice(0, 100) ?? ""}
      initialTypes={parseTypes(firstParam(params.types))}
      initialSelectedId={firstParam(params.route) ?? null}
      trip={from && to ? { from, to } : null}
    />
  );
}

export default function ExplorePage({ searchParams }: PageProps<"/explore">) {
  return (
    <Suspense fallback={<ExploreSkeleton />}>
      <ExploreContent searchParams={searchParams} />
    </Suspense>
  );
}
