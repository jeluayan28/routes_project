import { FlaskConical } from "lucide-react";
import type { DataSource } from "@/lib/data/routes";

/** Shown wherever development data is on screen so it cannot pass for real data. */
export function SampleDataBanner({ source }: { source: DataSource }) {
  if (source !== "sample") return null;
  return (
    <div
      role="note"
      className="flex items-start gap-2 rounded-lg border border-gold/70 bg-gold/15 px-3 py-2 text-sm text-foreground"
    >
      <FlaskConical aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <p>
        <strong>Development data.</strong> The routes, stops, and fares shown are samples for
        testing the interface. They are not real Butuan transport information.
      </p>
    </div>
  );
}
