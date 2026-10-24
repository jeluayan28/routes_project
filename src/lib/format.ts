import type { FareCategory } from "@/lib/validation/route";
import type { VehicleType } from "@/lib/validation/transport";

export const VEHICLE_LABEL: Record<VehicleType, string> = {
  minibus: "Minibus",
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

const pesoFormat = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The one way peso amounts are shown: ₱12.00, ₱1,234.50. Always two decimals. */
export function formatPeso(amount: number): string {
  return pesoFormat.format(amount);
}

/** A timestamp or ISO date as a calendar date in Philippine time, e.g. "Jan 15, 2026". */
export function formatFareDate(iso: string): string {
  return new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeZone: "Asia/Manila" }).format(new Date(iso));
}
