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
  status: verificationStatusSchema,
  /** Passengers may board here on this route. */
  canBoard: z.boolean(),
  /** Passengers may get off here on this route. */
  canAlight: z.boolean(),
});
export type RouteStop = z.infer<typeof routeStopSchema>;

export const directionKindSchema = z.enum(["outbound", "inbound"]);
export type DirectionKind = z.infer<typeof directionKindSchema>;

/**
 * One travel direction of a route. Each direction has its own ordered stops and
 * its own geometry, because a return trip often uses different streets.
 */
export const routeDirectionSchema = z.object({
  kind: directionKindSchema,
  /** Ordered from where this direction starts to where it ends. */
  stops: z.array(routeStopSchema),
  /**
   * Recorded geometry as one or more lines (a MultiLineString has several).
   * Empty when no shape has been recorded: nothing is drawn, and a line is
   * never inferred from the stops.
   */
  paths: z.array(z.array(coordinateSchema).min(2)),
});
export type RouteDirection = z.infer<typeof routeDirectionSchema>;

export const routeSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  vehicleType: vehicleTypeSchema,
  status: verificationStatusSchema,
  /** "one-way" when only an outbound direction is recorded. */
  direction: z.enum(["both", "one-way"]),
  directionNote: z.string().optional(),
  /** Outbound first. At least one entry. */
  directions: z.array(routeDirectionSchema).min(1),
  fares: z.array(fareRecordSchema),
});
export type Route = z.infer<typeof routeSchema>;
