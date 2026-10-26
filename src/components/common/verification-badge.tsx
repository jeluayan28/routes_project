import { BadgeCheck, CircleHelp, Clock, FlaskConical, type LucideIcon } from "lucide-react";
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
    className: "border-primary/60 bg-primary/15 text-foreground",
  },
  unverified: {
    label: "Unverified",
    description: "Reported but not yet confirmed. May be wrong or outdated.",
    icon: CircleHelp,
    className: "border-gold bg-gold/25 text-foreground",
  },
  outdated: {
    label: "Outdated",
    description: "Was verified in the past but may no longer be accurate.",
    icon: Clock,
    className: "border-dashed border-gold bg-gold/15 text-foreground",
  },
  sample: {
    label: "Sample data",
    description: "Placeholder for development. Not real transport information.",
    icon: FlaskConical,
    className: "border-dashed border-input bg-muted text-foreground",
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
