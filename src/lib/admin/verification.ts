import { z } from "zod";

/** What an administrator confirms when verifying a route. Keys match public.verify_route(). */
export const VERIFICATION_CHECKS = [
  { key: "transport_type", label: "Transport type (jeepney or multicab) is correct" },
  { key: "name_direction", label: "Route name and each direction are correct" },
  { key: "endpoints", label: "Starting and ending points are correct" },
  { key: "stops", label: "Every intermediate stop is correct and in the right order" },
  { key: "geometry", label: "Route geometry follows the real road path" },
  { key: "boarding_dropoff", label: "Boarding and drop-off permissions are correct" },
  { key: "fares", label: "Fare rules are correct (or none are recorded for this route)" },
  { key: "passenger_categories", label: "Passenger categories (regular, student, …) are correct" },
] as const;

export type VerificationCheckKey = (typeof VERIFICATION_CHECKS)[number]["key"];

/** Today's calendar date in Asia/Manila (YYYY-MM-DD), matching the database. */
export function todayInManila(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

const checksShape = Object.fromEntries(
  VERIFICATION_CHECKS.map((c) => [c.key, z.literal(true, { error: "Confirm this before verifying." })]),
) as Record<VerificationCheckKey, z.ZodLiteral<true>>;

export const verificationInputSchema = z.object({
  routeId: z.uuid(),
  verifiedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date in YYYY-MM-DD form."),
  source: z.string().trim().min(3, "Say where the information was confirmed.").max(500),
  notes: z.string().trim().max(1000),
  checks: z.object(checksShape),
});

export type VerificationInput = z.infer<typeof verificationInputSchema>;
