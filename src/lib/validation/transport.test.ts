import { describe, expect, it } from "vitest";
import { coordinateSchema, verificationStatusSchema } from "./transport";

describe("transport validation", () => {
  it("rejects unknown verification statuses", () => {
    expect(verificationStatusSchema.safeParse("official").success).toBe(false);
    expect(verificationStatusSchema.safeParse("verified").success).toBe(true);
  });

  it("rejects out-of-range coordinates", () => {
    expect(coordinateSchema.safeParse({ lat: 91, lng: 0 }).success).toBe(false);
    expect(coordinateSchema.safeParse({ lat: 8.9, lng: 181 }).success).toBe(false);
    expect(coordinateSchema.safeParse({ lat: 8.9, lng: 125.5 }).success).toBe(true);
  });
});
