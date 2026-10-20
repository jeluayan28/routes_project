import { z } from "zod";
import {
  coordinateSchema,
  vehicleTypeSchema,
  verificationStatusSchema,
} from "@/lib/validation/transport";

export const fareCategorySchema = z.enum(["regular", "student", "senior", "pwd"]);
export type FareCategory = z.infer<typeof fareCategorySchema>;

export const fareRecordSchema = z.object({
  id: z.string(),
  category: fareCategorySchema,
  /** Philippine pesos. */
  amount: z.number().nonnegative(),
  status: verificationStatusSchema,
  /** ISO date (YYYY-MM-DD) the fare was last confirmed. Null if never verified. */
  verifiedOn: z.iso.date().nullable(),
  note: z.string().optional(),
});
export type FareRecord = z.infer<typeof fareRecordSchema>;

export const routeStopSchema = z.object({
  id: z.string(),
  name: z.string(),
  position: coordinateSchema,
});
export type RouteStop = z.infer<typeof routeStopSchema>;

export const routeSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  vehicleType: vehicleTypeSchema,
  status: verificationStatusSchema,
  direction: z.enum(["both", "one-way"]),
  directionNote: z.string().optional(),
  /** Ordered from the starting point to the ending point. */
  stops: z.array(routeStopSchema),
  /** Route line, ordered start to end. */
  path: z.array(coordinateSchema),
  fares: z.array(fareRecordSchema),
});
export type Route = z.infer<typeof routeSchema>;
