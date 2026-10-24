import { describe, expect, it } from "vitest";
import { validateTripSearch } from "./trip-search";

const valid = { from: "Place One", to: "Place Two", types: ["minibus"] };

describe("validateTripSearch", () => {
  it("accepts and trims valid input", () => {
    const r = validateTripSearch({ ...valid, from: "  Place One  " });
    expect(r.ok && r.value.from).toBe("Place One");
  });

  it("rejects empty and whitespace-only places", () => {
    const r = validateTripSearch({ ...valid, from: "   ", to: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.from).toBeTruthy();
      expect(r.errors.to).toBeTruthy();
    }
  });

  it("rejects identical origin and destination regardless of case", () => {
    const r = validateTripSearch({ ...valid, to: "place one" });
    expect(!r.ok && r.errors.to).toMatch(/different/);
  });

  it("requires at least one transport type", () => {
    const r = validateTripSearch({ ...valid, types: [] });
    expect(!r.ok && r.errors.types).toBeTruthy();
  });

  it("rejects overlong input", () => {
    const r = validateTripSearch({ ...valid, from: "x".repeat(101) });
    expect(r.ok).toBe(false);
  });
});
