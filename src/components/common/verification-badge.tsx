import { BadgeCheck, CircleHelp, FlaskConical, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { VerificationStatus } from "@/lib/validation/transport";

const STATUS: Record<
  VerificationStatus,
  { label: string; description: string; icon: LucideIcon; className: string }
> = {
  verified: {
    label: "Verified",
    description: "Confirmed against an official or first-hand source.",
    icon: BadgeCheck,
    className: "border-emerald-600/40 bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
  },
  unverified: {
    label: "Unverified",
    description: "Reported but not yet confirmed. May be wrong or outdated.",
    icon: CircleHelp,
    className: "border-amber-600/40 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100",
  },
  sample: {
    label: "Sample data",
    description: "Placeholder for development. Not real transport information.",
    icon: FlaskConical,
    className: "border-sky-600/40 bg-sky-50 text-sky-900 dark:bg-sky-950 dark:text-sky-100",
  },
};

export function getVerificationDescription(status: VerificationStatus) {
  return STATUS[status].description;
}

export function VerificationBadge({
  status,
  className,
}: {
  status: VerificationStatus;
  className?: string;
}) {
  const { label, icon: Icon, className: tone, description } = STATUS[status];
  return (
    <Badge variant="outline" className={cn(tone, className)} title={description}>
      <Icon aria-hidden="true" />
      {label}
    </Badge>
  );
}
