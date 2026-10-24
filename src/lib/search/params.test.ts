import { describe, expect, it } from "vitest";
import { parseTripParams, tripQuery } from "@/lib/search/params";

describe("parseTripParams", () => {
  it("is empty when no places are given", () => {
    expect(parseTripParams({})).toEqual({ status: "empty" });
    expect(parseTripParams({ from: " ", to: "" })).toEqual({ status: "empty" });
  });

  it("asks for the missing place", () => {
    expect(parseTripParams({ from: "A" })).toEqual({ status: "invalid", message: "Enter a destination." });
    expect(parseTripParams({ to: "B" })).toEqual({ status: "invalid", message: "Enter a starting point." });
  });

  it("applies defaults", () => {
    expect(parseTripParams({ from: "A", to: "B" })).toEqual({
      status: "ok",
      value: { from: "A", to: "B", types: ["minibus", "multicab"], category: "regular", maxTransfers: 2, preference: "fewest-transfers" },
    });
  });

  it("reads every option", () => {
    const r = parseTripParams({ from: "A", to: "B", types: "multicab", category: "student", transfers: "1", pref: "lowest-fare" });
    expect(r).toMatchObject({ status: "ok", value: { types: ["multicab"], category: "student", maxTransfers: 1, preference: "lowest-fare" } });
  });

  it.each([["-1"], ["5"], ["1.5"], ["x"], [""]])("falls back to the default for transfers=%j", (transfers) => {
    expect(parseTripParams({ from: "A", to: "B", transfers })).toMatchObject({ value: { maxTransfers: 2 } });
  });

  it("falls back for an unknown category or preference", () => {
    expect(parseTripParams({ from: "A", to: "B", category: "vip", pref: "fastest" })).toMatchObject({
      value: { category: "regular", preference: "fewest-transfers" },
    });
  });

  it("allows zero transfers and the maximum of four", () => {
    expect(parseTripParams({ from: "A", to: "B", transfers: "0" })).toMatchObject({ value: { maxTransfers: 0 } });
    expect(parseTripParams({ from: "A", to: "B", transfers: "4" })).toMatchObject({ value: { maxTransfers: 4 } });
  });

  it("rejects overlong places", () => {
    expect(parseTripParams({ from: "x".repeat(121), to: "B" })).toMatchObject({ status: "invalid" });
  });

  it("round-trips through tripQuery", () => {
    const parsed = parseTripParams({ from: "Café, Plaza", to: "stop:abc", types: "minibus", category: "pwd", transfers: "3", pref: "shortest-walking" });
    if (parsed.status !== "ok") throw new Error("parse failed");
    const again = parseTripParams(Object.fromEntries(new URLSearchParams(tripQuery(parsed.value))));
    expect(again).toEqual(parsed);
  });
});
