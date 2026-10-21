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
