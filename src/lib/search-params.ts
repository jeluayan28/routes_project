import { vehicleTypeSchema, type VehicleType } from "@/lib/validation/transport";

export type RawSearchParams = Record<string, string | string[] | undefined>;

export function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const ALL_TYPES: VehicleType[] = [...vehicleTypeSchema.options];

/** Parses `types=minibus,multicab`; unknown values are dropped, missing means all. */
export function parseTypes(value: string | undefined): VehicleType[] {
  if (!value) return ALL_TYPES;
  const parsed = value
    .split(",")
    .map((v) => vehicleTypeSchema.safeParse(v.trim()))
    .flatMap((r) => (r.success ? [r.data] : []));
  return parsed.length > 0 ? [...new Set(parsed)] : ALL_TYPES;
}
