import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { BadgeCheck, Receipt } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorMessage } from "@/components/common/error-message";
import { SampleDataBanner } from "@/components/common/sample-data-banner";
import { VerificationNotice } from "@/components/common/verification-notice";
import { FareBadge } from "@/components/fares/fare-badge";
import { VehicleIcon } from "@/components/routes/vehicle-icon";
import { Skeleton } from "@/components/ui/skeleton";
import { getRoutes } from "@/lib/data/routes";
import { VEHICLE_LABEL } from "@/lib/format";

export const metadata: Metadata = {
  title: "Fare Guide",
  description: "Verified jeepney and multicab fares in Butuan City, with verification dates.",
};

async function FareContent() {
  const result = await getRoutes();
  if (result.status === "error") {
    return <ErrorMessage title="Couldn't load fares" message={result.message} />;
  }

  const withFares = result.data.filter((r) => r.fares.length > 0);
  const verifiedCount = result.data.flatMap((r) => r.fares).filter((f) => f.status === "verified").length;

  return (
    <div className="space-y-6">
      <SampleDataBanner source={result.source} />

      {verifiedCount === 0 && (
        <div role="status" className="flex items-start gap-3 rounded-xl border border-red-600/25 bg-red-50 px-4 py-3 text-sm text-red-900">
          <Receipt aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <p>
            <strong>No verified fares have been published yet.</strong> This site will not show a fare
            as confirmed until it has been checked against an official or first-hand source.
          </p>
        </div>
      )}

      {withFares.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="No fare records yet"
          description="Fares will be listed here, with the date each was verified, once local data has been added."
        />
      ) : (
        <ul className="space-y-4">
          {withFares.map((route) => (
            <li key={route.id} className="rounded-2xl border bg-card p-5 shadow-xs">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="flex items-center gap-1.5 text-sm font-medium text-primary">
                    <VehicleIcon type={route.vehicleType} className="size-4" />
                    {VEHICLE_LABEL[route.vehicleType]} · {route.code}
                  </p>
                  <h2 className="font-semibold">{route.name}</h2>
                </div>
                <Link href={`/routes/${route.id}`} className="text-sm font-medium text-primary underline-offset-4 hover:underline">
                  View route<span className="sr-only"> {route.name}</span>
                </Link>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {route.fares.map((fare) => (
                  <FareBadge key={fare.id} fare={fare} />
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FareSkeleton() {
  return (
    <div role="status" aria-label="Loading fares" className="space-y-4">
      <Skeleton className="h-32 w-full rounded-2xl" />
      <Skeleton className="h-32 w-full rounded-2xl" />
    </div>
  );
}

export default function FareGuidePage() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-8 px-4 py-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Fare Guide</h1>
        <p className="text-muted-foreground">
          Fares for jeepneys and multicabs in Butuan City, each labelled with its verification status
          and the date it was last confirmed.
        </p>
      </header>

      <section aria-labelledby="categories-heading" className="space-y-3 rounded-2xl border bg-card p-5 shadow-xs">
        <h2 id="categories-heading" className="flex items-center gap-2 font-semibold">
          <BadgeCheck aria-hidden="true" className="size-4 text-green-700" />
          Fare categories
        </h2>
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="font-medium">Regular</dt>
            <dd className="text-muted-foreground">The standard fare for an adult passenger.</dd>
          </div>
          <div>
            <dt className="font-medium">Student</dt>
            <dd className="text-muted-foreground">
              A discounted fare for students, where it applies. Carry a valid school ID.
            </dd>
          </div>
          <div>
            <dt className="font-medium">Senior citizen and PWD</dt>
            <dd className="text-muted-foreground">
              Discounts may also apply to senior citizens and persons with disability. They are shown
              only when a fare record exists.
            </dd>
          </div>
        </dl>
      </section>

      <Suspense fallback={<FareSkeleton />}>
        <FareContent />
      </Suspense>

      <VerificationNotice />
    </div>
  );
}
