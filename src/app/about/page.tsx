  import type { Metadata } from "next";
import { Mail } from "lucide-react";
import { ReportLink } from "@/components/reports/report-link";
import { VerificationNotice } from "@/components/common/verification-notice";
import { buttonVariants } from "@/components/ui/button";
import { getContactEmail } from "@/lib/data/config";
import { SITE_NAME } from "@/lib/constants";

export const metadata: Metadata = {
  title: "About",
  description: "Why Butuan Route Finder exists and how its information is verified.",
};

export default function AboutPage() {
  const email = getContactEmail();

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8 px-4 py-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">About {SITE_NAME}</h1>
        <p className="text-muted-foreground">
          A free, no-account guide to minibus and multicab routes, stops, and fares in Butuan City.
        </p>
      </header>

      <section aria-labelledby="purpose" className="space-y-2">
        <h2 id="purpose" className="text-xl font-semibold">Purpose</h2>
        <p>
          Public transport in Butuan is informal and easy to get wrong when you are new, or when a
          route has changed. This site aims to put routes, boarding and drop-off points, and fares in
          one place that anyone can use without signing up or paying.
        </p>
      </section>

      <section aria-labelledby="verification" className="space-y-3">
        <h2 id="verification" className="text-xl font-semibold">Verify before you rely on it</h2>
        <p>
          Every route, stop, and fare is labelled <em>verified</em>, <em>unverified</em>, or{" "}
          <em>sample</em>. Only verified information has been checked against an official or
          first-hand source, and verified fares show the date they were confirmed. Routes and fares
          change, so treat this site as a guide and confirm with the driver or operator.
        </p>
        <VerificationNotice />
      </section>

      <section id="report" aria-labelledby="report-heading" className="scroll-mt-20 space-y-3">
        <h2 id="report-heading" className="text-xl font-semibold">Report incorrect information</h2>
        <p>
          Found a wrong fare, a missing stop, or a route that no longer runs? Use the report form. You don&apos;t need an account, and nothing changes until an
          administrator has checked your report.
        </p>
        <ReportLink />
        {email && (
          <>
            <p>
              You can also write to us. Tell us which route
              and what should change.
            </p>
            <a href={`mailto:${email}?subject=${encodeURIComponent("Correction: Butuan Route Finder")}`} className={buttonVariants()}>
              <Mail aria-hidden="true" />
              Email {email}
            </a>
          </>
        )}
      </section>
    </div>
  );
}
