import { ShieldAlert } from "lucide-react";

export function VerificationNotice() {
  return (
    <div
      role="note"
      className="flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground"
    >
      <ShieldAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-foreground" />
      <p>
        <strong className="text-foreground">Accuracy depends on verified local data.</strong> Routes and fares can change.
        Information is labelled as verified, unverified, or sample, and fares may differ from what
        your driver charges. Please report anything that looks wrong.
      </p>
    </div>
  );
}
