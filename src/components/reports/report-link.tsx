import Link from "next/link";
import { Flag } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { getContactEmail } from "@/lib/data/config";
import { cn } from "@/lib/utils";

/**
 * "Report incorrect information" action. Until an in-app report form exists it
 * opens an email to the configured contact; if none is configured it points to
 * the About page, which explains that. It is always a working link.
 */
export function ReportLink({ subject, className }: { subject: string; className?: string }) {
  const email = getContactEmail();
  const classes = cn(buttonVariants({ variant: "outline" }), className);

  if (email) {
    const href = `mailto:${email}?subject=${encodeURIComponent(`Correction: ${subject}`)}`;
    return (
      <a href={href} className={classes}>
        <Flag aria-hidden="true" />
        Report incorrect information
      </a>
    );
  }
  return (
    <Link href="/about#report" className={classes}>
      <Flag aria-hidden="true" />
      Report incorrect information
    </Link>
  );
}
