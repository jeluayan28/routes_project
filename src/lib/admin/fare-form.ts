import { z } from "zod";
import { parseAmount, parseIsoDate } from "@/lib/import/validate";
import { fareCategorySchema } from "@/lib/validation/route";

const optionalUuid = z.uuid().nullable();
const isoDate = z.string().superRefine((value, ctx) => {
  const r = parseIsoDate(value);
  if (!r.ok) ctx.addIssue({ code: "custom", message: r.message });
});

/**
 * One fare rule. Leave both stops null for a flat fare on the whole route.
 * `amount` is entered as text so it is validated exactly like the CSV importer.
 */
export const fareInputSchema = z
  .object({
    id: z.uuid().nullable(),
    routeId: z.uuid(),
    fromStopId: optionalUuid,
    toStopId: optionalUuid,
    passengerType: fareCategorySchema,
    amount: z.string().superRefine((value, ctx) => {
      const r = parseAmount(value);
      if (!r.ok) ctx.addIssue({ code: "custom", message: r.message });
    }),
    effectiveFrom: isoDate,
    effectiveUntil: z.union([isoDate, z.literal("")]),
    source: z.string().trim().max(300),
  })
  .superRefine((fare, ctx) => {
    if ((fare.fromStopId === null) !== (fare.toStopId === null)) {
      ctx.addIssue({ code: "custom", path: ["toStopId"], message: "Choose both an origin and a destination, or neither for a flat route fare." });
    }
    if (fare.fromStopId && fare.fromStopId === fare.toStopId) {
      ctx.addIssue({ code: "custom", path: ["toStopId"], message: "The origin and destination must be different stops." });
    }
    if (fare.effectiveUntil && fare.effectiveUntil < fare.effectiveFrom) {
      ctx.addIssue({ code: "custom", path: ["effectiveUntil"], message: "The end date is before the start date." });
    }
  });

export type FareInput = z.infer<typeof fareInputSchema>;

/** A price change on an existing fare: the old rule is kept and ended the day before. */
export const changeFareSchema = z.object({
  fareId: z.uuid(),
  amount: fareInputSchema.shape.amount,
  effectiveFrom: isoDate,
  source: z.string().trim().min(3, "Say where the new fare comes from.").max(300),
});

export const endFareSchema = z.object({ fareId: z.uuid(), effectiveUntil: isoDate });

/**
 * An existing fare that would share a price slot with this one on some day: same
 * stops and passenger category, overlapping dates. The database refuses this too;
 * checking here gives an immediate, specific message.
 */
export function findOverlap<
  F extends { id: string; from_stop_id: string | null; to_stop_id: string | null; passenger_type: string; effective_from: string; effective_until: string | null },
>(existing: readonly F[], fare: Pick<FareInput, "id" | "fromStopId" | "toStopId" | "passengerType" | "effectiveFrom" | "effectiveUntil">): F | null {
  const until = fare.effectiveUntil || "9999-12-31";
  return (
    existing.find(
      (f) =>
        f.id !== fare.id &&
        f.from_stop_id === fare.fromStopId &&
        f.to_stop_id === fare.toStopId &&
        f.passenger_type === fare.passengerType &&
        f.effective_from <= until &&
        fare.effectiveFrom <= (f.effective_until ?? "9999-12-31"),
    ) ?? null
  );
}
