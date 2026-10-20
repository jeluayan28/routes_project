import { ShieldAlert } from "lucide-react";

export function VerificationNotice() {
  return (
    <div
      role="note"
      className="flex items-start gap-3 rounded-xl border border-red-600/25 bg-red-50 px-4 py-3 text-sm text-red-900"
    >
      <ShieldAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <p>
        <strong>Accuracy depends on verified local data.</strong> Routes and fares can change.
        Information is labelled as verified, unverified, or sample, and fares may differ from what
        your driver charges. Please report anything that looks wrong.
      </p>
    </div>
  );
}
