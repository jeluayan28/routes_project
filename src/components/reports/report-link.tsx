import Link from "next/link";
import { Flag } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import type { PublicReportType } from "@/lib/reports/schema";
import { cn } from "@/lib/utils";

/**
 * "Report incorrect information": opens the report form, pre-filled with what the
 * visitor was looking at. No account is needed.
 */
export function ReportLink({
  type,
  routeId,
  stopId,
  direction,
  className,
}: {
  type?: PublicReportType;
  routeId?: string;
  stopId?: string;
  direction?: "outbound" | "inbound";
  className?: string;
}) {
  const q = new URLSearchParams();
  if (type) q.set("type", type);
  if (routeId) q.set("route", routeId);
  if (stopId) q.set("stop", stopId);
  if (direction) q.set("direction", direction);
  const query = q.toString();
  return (
    <Link href={`/report${query ? `?${query}` : ""}`} className={cn(buttonVariants({ variant: "outline" }), "h-10 px-3", className)}>
      <Flag aria-hidden="true" />
      Report incorrect information
    </Link>
  );
}
