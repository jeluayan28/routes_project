import type { FareCategory } from "@/lib/validation/route";
import type { VehicleType } from "@/lib/validation/transport";

export const VEHICLE_LABEL: Record<VehicleType, string> = {
  jeepney: "Jeepney",
  multicab: "Multicab",
};

export const FARE_CATEGORY_LABEL: Record<FareCategory, string> = {
  regular: "Regular",
  student: "Student",
  senior: "Senior citizen",
  pwd: "PWD",
};

const dateFormat = new Intl.DateTimeFormat("en-PH", {
  year: "numeric",
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});

/** Formats an ISO date (YYYY-MM-DD) without timezone drift. */
export function formatVerifiedDate(iso: string | null): string {
  if (!iso) return "Not yet verified";
  return dateFormat.format(new Date(`${iso}T00:00:00Z`));
}

export function formatPeso(amount: number): string {
  return `₱${amount.toFixed(2)}`;
}
