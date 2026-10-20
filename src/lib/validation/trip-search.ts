import { z } from "zod";
import { vehicleTypeSchema } from "@/lib/validation/transport";

const placeSchema = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `Enter ${label}.`)
    .max(100, `${label[0].toUpperCase()}${label.slice(1)} is too long (100 characters max).`);

export const tripSearchSchema = z
  .object({
    from: placeSchema("a starting point"),
    to: placeSchema("a destination"),
    types: z.array(vehicleTypeSchema).min(1, "Choose at least one transport type."),
  })
  .refine((v) => v.from.toLowerCase() !== v.to.toLowerCase(), {
    path: ["to"],
    message: "Destination must be different from the starting point.",
  });

export type TripSearchInput = z.infer<typeof tripSearchSchema>;

export type TripSearchErrors = Partial<Record<"from" | "to" | "types", string>>;

/** Validates raw form values and returns the first error per field. */
export function validateTripSearch(
  raw: unknown,
): { ok: true; value: TripSearchInput } | { ok: false; errors: TripSearchErrors } {
  const parsed = tripSearchSchema.safeParse(raw);
  if (parsed.success) return { ok: true, value: parsed.data };
  const errors: TripSearchErrors = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path[0];
    if ((key === "from" || key === "to" || key === "types") && !errors[key]) {
      errors[key] = issue.message;
    }
  }
  return { ok: false, errors };
}
