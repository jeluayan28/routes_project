"use client";

import { VehicleIcon } from "@/components/routes/vehicle-icon";
import { VEHICLE_LABEL } from "@/lib/format";
import { cn } from "@/lib/utils";
import { vehicleTypeSchema, type VehicleType } from "@/lib/validation/transport";

const TYPES = vehicleTypeSchema.options;

type TransportFilterProps = {
  value: readonly VehicleType[];
  onChange: (next: VehicleType[]) => void;
  legend?: string;
  describedBy?: string;
  className?: string;
};

/** Multi-select toggle buttons for vehicle types. Each is a real button with aria-pressed. */
export function TransportFilter({
  value,
  onChange,
  legend = "Transport type",
  describedBy,
  className,
}: TransportFilterProps) {
  const toggle = (type: VehicleType) =>
    onChange(value.includes(type) ? value.filter((t) => t !== type) : [...value, type]);

  return (
    <div role="group" aria-label={legend} aria-describedby={describedBy} className={cn("flex flex-wrap gap-2", className)}>
      {TYPES.map((type) => {
        const on = value.includes(type);
        return (
          <button
            key={type}
            type="button"
            aria-pressed={on}
            onClick={() => toggle(type)}
            className={cn(
              "inline-flex h-9 items-center gap-2 rounded-full border px-3.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
              on
                ? "border-primary bg-primary text-primary-foreground"
                : "bg-card text-foreground hover:bg-accent",
            )}
          >
            <VehicleIcon type={type} className="size-4" />
            {VEHICLE_LABEL[type]}
          </button>
        );
      })}
    </div>
  );
}
