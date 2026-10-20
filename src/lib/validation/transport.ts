import { z } from "zod";

/**
 * Every transport record carries a verification status so the UI can never
 * present sample or unverified data as fact.
 */
export const verificationStatusSchema = z.enum([
  "verified",
  "unverified",
  "sample",
]);
export type VerificationStatus = z.infer<typeof verificationStatusSchema>;

export const vehicleTypeSchema = z.enum(["jeepney", "multicab"]);
export type VehicleType = z.infer<typeof vehicleTypeSchema>;

export const latitudeSchema = z.number().min(-90).max(90);
export const longitudeSchema = z.number().min(-180).max(180);

export const coordinateSchema = z.object({
  lat: latitudeSchema,
  lng: longitudeSchema,
});
export type Coordinate = z.infer<typeof coordinateSchema>;
