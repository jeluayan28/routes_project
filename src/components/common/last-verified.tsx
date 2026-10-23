import { VERIFICATION_STALE_AFTER_DAYS } from "@/lib/constants";
import { formatFareDate } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * When a route was last checked by an administrator, so riders can judge how far
 * to trust it. Older than the configured threshold is called out. Nothing here
 * is taken from a public report: only an administrator's verification sets it.
 */
export function LastVerified({ at, className }: { at: string | null | undefined; className?: string }) {
  if (!at) return <p className={cn("text-xs text-muted-foreground", className)}>Last verified: date not recorded.</p>;
  const old = new Date().getTime() - new Date(at).getTime() > VERIFICATION_STALE_AFTER_DAYS * 86_400_000;
  return (
    <p className={cn("text-xs", old ? "font-medium text-amber-800" : "text-muted-foreground", className)}>
      Last verified {formatFareDate(at)}
      {old && ". This is a while ago, so details such as fares or stops may have changed."}
    </p>
  );
}
