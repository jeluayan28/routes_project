import { VerificationBadge } from "@/components/common/verification-badge";
import { FARE_CATEGORY_LABEL, formatPeso, formatVerifiedDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { FareRecord } from "@/lib/validation/route";

/**
 * One fare with its category, verification label, and verification date.
 * Unverified and sample amounts are visually muted so they never read as fact.
 */
export function FareBadge({ fare, className }: { fare: FareRecord; className?: string }) {
  const confirmed = fare.status === "verified";
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2",
        confirmed ? "border-gold bg-gold/20 text-foreground" : "border-dashed bg-muted/50",
        className,
      )}
    >
      <div>
        <p className="text-sm text-muted-foreground">{FARE_CATEGORY_LABEL[fare.category]}</p>
        <p
          className={cn("text-lg font-semibold", !confirmed && "text-muted-foreground")}
          aria-label={`${FARE_CATEGORY_LABEL[fare.category]} fare ${formatPeso(fare.amount)}, ${fare.status}`}
        >
          {formatPeso(fare.amount)}
        </p>
      </div>
      <div className="flex flex-col items-end gap-1 text-right">
        <VerificationBadge status={fare.status} />
        <p className="text-xs text-muted-foreground">
          {confirmed ? `Verified ${formatVerifiedDate(fare.verifiedOn)}` : "Not a confirmed fare"}
        </p>
      </div>
    </div>
  );
}
