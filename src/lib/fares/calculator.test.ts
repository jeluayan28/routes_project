import { describe, expect, it } from "vitest";
import { calculateFare, calculateSegmentFare, calculateTripFare } from "@/lib/fares/calculator";
import { fromCentavos, pesosToCentavos } from "@/lib/fares/money";
import { auditFareRules, ruleProblem } from "@/lib/fares/rules";
import type { FareOptions, FareRule } from "@/lib/fares/types";
import { formatPeso } from "@/lib/format";

/** Fictional rules only. Nothing here is a real Butuan fare. */
const rule = (over: Partial<FareRule> = {}): FareRule => ({
  id: "r-1", routeId: "R1", fromStopId: null, toStopId: null, category: "regular", amount: 10,
  effectiveFrom: "2026-01-01", effectiveUntil: null, status: "verified",
  source: "Fictional fare table", verifiedAt: "2026-02-01T00:00:00Z", ...over,
});
const OPTS: FareOptions = { category: "regular", date: "2026-06-01" };
const ride = { routeId: "R1", boardingStopId: "A", dropoffStopId: "C" };
const seg = (rules: FareRule[], over: Partial<FareOptions> = {}) => calculateSegmentFare(rules, ride, { ...OPTS, ...over });

describe("effective dates", () => {
  const rules = [
    rule({ id: "old", amount: 10, effectiveFrom: "2026-01-01", effectiveUntil: "2026-05-31" }),
    rule({ id: "new", amount: 12, effectiveFrom: "2026-06-01" }),
  ];

  it("picks the rule in force on the date, inclusive at both ends", () => {
    expect(seg(rules, { date: "2026-05-31" })).toMatchObject({ status: "known", amount: 10, ruleId: "old" });
    expect(seg(rules, { date: "2026-06-01" })).toMatchObject({ status: "known", amount: 12, ruleId: "new" });
    expect(seg(rules, { date: "2026-01-01" })).toMatchObject({ amount: 10 });
  });

  it("says a fare is not in force before it starts or after it ends", () => {
    expect(seg(rules, { date: "2025-12-31" })).toEqual({ status: "unavailable", reason: "fare-not-in-force" });
    expect(seg([rule({ effectiveUntil: "2026-03-31" })])).toEqual({ status: "unavailable", reason: "fare-not-in-force" });
  });

  it("never falls back to an expired price", () => {
    expect(seg([rule({ amount: 9, effectiveUntil: "2026-03-31" })]).status).toBe("unavailable");
  });
});

describe("missing rules", () => {
  it("has no default fare", () => {
    expect(seg([])).toEqual({ status: "unavailable", reason: "no-fare-record" });
  });

  it("ignores rules for other routes", () => {
    expect(seg([rule({ routeId: "R2" })])).toEqual({ status: "unavailable", reason: "no-fare-record" });
  });

  it("ignores stop-to-stop rules for other stops, and the reverse direction", () => {
    expect(seg([rule({ fromStopId: "A", toStopId: "B" })]).status).toBe("unavailable");
    expect(seg([rule({ fromStopId: "C", toStopId: "A" })]).status).toBe("unavailable");
  });

  it("does not use the flat fare when a rule for the exact stops exists but is unusable", () => {
    const rules = [rule({ id: "flat", amount: 10 }), rule({ id: "pair", fromStopId: "A", toStopId: "C", amount: -5 })];
    expect(seg(rules)).toEqual({ status: "unavailable", reason: "invalid-fare-record" });
  });

  it("prefers the exact stops over the flat fare when both are usable", () => {
    const rules = [rule({ id: "flat", amount: 10 }), rule({ id: "pair", fromStopId: "A", toStopId: "C", amount: 8 })];
    expect(seg(rules)).toMatchObject({ amount: 8, basis: "stop-to-stop", ruleId: "pair" });
    expect(calculateSegmentFare(rules, { routeId: "R1", boardingStopId: "A", dropoffStopId: "B" }, OPTS)).toMatchObject({ amount: 10, basis: "flat" });
  });

  it("rejects a segment with no distinct stops", () => {
    const flat = [rule()];
    expect(calculateSegmentFare(flat, { routeId: "R1", boardingStopId: "A", dropoffStopId: "A" }, OPTS)).toEqual({ status: "unavailable", reason: "invalid-segment" });
    expect(calculateSegmentFare(flat, { routeId: "R1", boardingStopId: "", dropoffStopId: "C" }, OPTS)).toEqual({ status: "unavailable", reason: "invalid-segment" });
  });
});

describe("passenger categories", () => {
  const rules = [rule({ id: "reg", amount: 12 }), rule({ id: "stu", category: "student", amount: 9.5 })];

  it("prices regular and student separately", () => {
    expect(seg(rules, { category: "regular" })).toMatchObject({ amount: 12, category: "regular" });
    expect(seg(rules, { category: "student" })).toMatchObject({ amount: 9.5, category: "student" });
  });

  it("never shows the regular fare as a student fare", () => {
    expect(seg([rule({ amount: 12 })], { category: "student" })).toEqual({ status: "unavailable", reason: "no-fare-for-category" });
  });
});

describe("verification", () => {
  it("only prices from verified rules by default, and says so", () => {
    expect(seg([rule({ status: "unverified" })])).toEqual({ status: "unavailable", reason: "fare-not-verified" });
    expect(seg([rule({ status: "outdated" })])).toEqual({ status: "unavailable", reason: "fare-not-verified" });
    expect(seg([rule({ status: "sample" })])).toEqual({ status: "unavailable", reason: "fare-not-verified" });
  });

  it("can be asked to include unverified rules, and labels them", () => {
    const r = seg([rule({ status: "unverified", verifiedAt: null })], { acceptStatuses: ["verified", "unverified"] });
    expect(r).toMatchObject({ status: "known", dataStatus: "unverified", verifiedAt: null });
  });

  it("lets a verified rule override an unverified draft instead of conflicting with it", () => {
    const rules = [rule({ id: "v", amount: 10 }), rule({ id: "d", amount: 99, status: "unverified" })];
    expect(seg(rules, { acceptStatuses: ["verified", "unverified"] })).toMatchObject({ amount: 10, dataStatus: "verified" });
  });

  it("carries the source and verification time of the rule used", () => {
    expect(seg([rule()])).toMatchObject({ source: "Fictional fare table", verifiedAt: "2026-02-01T00:00:00Z", effectiveFrom: "2026-01-01", effectiveUntil: null });
    expect(seg([rule({ source: "  ", verifiedAt: null })])).toMatchObject({ source: null, verifiedAt: null });
  });
});

describe("duplicate and conflicting rules", () => {
  it("collapses identical duplicates to one rule, deterministically", () => {
    const a = rule({ id: "b-dup", amount: 10 });
    const b = rule({ id: "a-dup", amount: 10 });
    expect(seg([a, b])).toMatchObject({ status: "known", amount: 10, ruleId: "a-dup" });
    expect(seg([b, a])).toMatchObject({ ruleId: "a-dup" });
  });

  it("rejects overlapping rules with different prices instead of choosing", () => {
    expect(seg([rule({ id: "x", amount: 10 }), rule({ id: "y", amount: 11 })])).toEqual({ status: "unavailable", reason: "conflicting-fare-rules" });
  });

  it("does not treat back-to-back periods as a conflict", () => {
    const rules = [rule({ id: "x", amount: 10, effectiveUntil: "2026-05-31" }), rule({ id: "y", amount: 11, effectiveFrom: "2026-06-01" })];
    expect(seg(rules)).toMatchObject({ amount: 11 });
  });

  it("audits a rule set: duplicates are dropped, conflicts reject every rule involved", () => {
    const dup1 = rule({ id: "d1", routeId: "RD" });
    const dup2 = rule({ id: "d2", routeId: "RD" });
    const c1 = rule({ id: "c1", routeId: "RC", amount: 10 });
    const c2 = rule({ id: "c2", routeId: "RC", amount: 12, effectiveFrom: "2026-03-01" });
    const fine = rule({ id: "ok", routeId: "RO" });
    const { valid, issues } = auditFareRules([dup1, dup2, c1, c2, fine]);
    expect(valid.map((r) => r.id)).toEqual(["d1", "ok"]);
    expect(issues.map((i) => [i.rule.id, i.code])).toEqual([["d2", "duplicate-rule"], ["c1", "conflicting-rules"], ["c2", "conflicting-rules"]]);
  });

  it("does not call rules for different categories or stops duplicates", () => {
    const { valid } = auditFareRules([rule({ id: "a" }), rule({ id: "b", category: "student" }), rule({ id: "c", fromStopId: "A", toStopId: "B" })]);
    expect(valid).toHaveLength(3);
  });
});

describe("invalid values", () => {
  const bad: [string, Partial<FareRule>, string][] = [
    ["a negative amount", { amount: -1 }, "invalid-amount"],
    ["NaN", { amount: NaN }, "invalid-amount"],
    ["Infinity", { amount: Infinity }, "invalid-amount"],
    ["more than two decimals", { amount: 12.345 }, "invalid-amount"],
    ["an amount beyond the column range", { amount: 1_000_000 }, "invalid-amount"],
    ["an amount that is not a number", { amount: "12" as unknown as number }, "invalid-amount"],
    ["a currency other than PHP", { currency: "USD" }, "invalid-currency"],
    ["an unknown category", { category: "vip" as FareRule["category"] }, "invalid-category"],
    ["an impossible date", { effectiveFrom: "2026-02-30" }, "invalid-date"],
    ["a malformed date", { effectiveFrom: "June 1" }, "invalid-date"],
    ["an end before the start", { effectiveFrom: "2026-06-01", effectiveUntil: "2026-05-01" }, "invalid-period"],
    ["only one stop", { fromStopId: "A", toStopId: null }, "invalid-stops"],
    ["the same stop twice", { fromStopId: "A", toStopId: "A" }, "invalid-stops"],
    ["no route", { routeId: "" }, "invalid-route"],
  ];

  it.each(bad)("flags %s", (_name, over, code) => {
    expect(ruleProblem(rule(over))).toBe(code);
    expect(auditFareRules([rule(over)])).toMatchObject({ valid: [], issues: [{ code }] });
  });

  it("accepts a free (zero) fare and exact two-decimal amounts", () => {
    expect(ruleProblem(rule({ amount: 0 }))).toBeNull();
    expect(ruleProblem(rule({ amount: 8.5 }))).toBeNull();
    expect(ruleProblem(rule({ amount: 999999.99 }))).toBeNull();
  });

  it("never prices from an invalid rule", () => {
    expect(seg([rule({ amount: -3 })])).toEqual({ status: "unavailable", reason: "invalid-fare-record" });
    expect(seg([rule({ amount: 7.123 })])).toEqual({ status: "unavailable", reason: "invalid-fare-record" });
    expect(seg([rule({ effectiveFrom: "nonsense" })])).toEqual({ status: "unavailable", reason: "invalid-fare-record" });
  });
});

describe("money", () => {
  it("converts to exact centavos, so sums do not drift", () => {
    expect(pesosToCentavos(0.1 + 0.2)).toBe(30);
    expect(pesosToCentavos(8.5)).toBe(850);
    expect(pesosToCentavos(0.001)).toBeNull();
    expect(fromCentavos(1050)).toBe(10.5);
    const legs = Array.from({ length: 10 }, (_, i) => rule({ id: `l${i}`, routeId: `R${i}`, amount: 0.1 }));
    const trip = calculateTripFare(legs, legs.map((l) => ({ routeId: l.routeId, boardingStopId: "A", dropoffStopId: "B" })), OPTS);
    expect(trip.total).toBe(1);
  });

  it("formats pesos the same way everywhere", () => {
    expect(formatPeso(12)).toBe("₱12.00");
    expect(formatPeso(8.5)).toBe("₱8.50");
    expect(formatPeso(1234.5)).toBe("₱1,234.50");
    expect(formatPeso(0)).toBe("₱0.00");
  });
});

describe("trips with several segments", () => {
  const rules = [
    rule({ id: "a", routeId: "R1", amount: 12 }),
    rule({ id: "b", routeId: "R2", amount: 8.5, verifiedAt: "2026-01-10T00:00:00Z", source: "Other table" }),
    rule({ id: "c", routeId: "R3", amount: 15, fromStopId: "X", toStopId: "Y" }),
  ];
  const segs = [
    { routeId: "R1", routeName: "One", boardingStopId: "A", dropoffStopId: "B" },
    { routeId: "R2", routeName: "Two", boardingStopId: "B", dropoffStopId: "C" },
  ];

  it("prices each segment separately and totals them", () => {
    const t = calculateTripFare(rules, segs, OPTS);
    expect(t.total).toBe(20.5);
    expect(t.verification).toBe("verified");
    expect(t.segments.map((s) => s.fare.status === "known" && s.fare.amount)).toEqual([12, 8.5]);
    expect(t.missing).toEqual([]);
    expect(t.verifiedAt).toBe("2026-01-10T00:00:00Z");
    expect(t.sources).toEqual(["Fictional fare table", "Other table"]);
  });

  it("gives no total if any segment is unknown, and does not fill it in", () => {
    const t = calculateTripFare(rules, [...segs, { routeId: "R3", boardingStopId: "C", dropoffStopId: "D" }], OPTS);
    expect(t.total).toBeNull();
    expect(t.verification).toBe("unavailable");
    expect(t.missing).toEqual([2]);
    expect(t.knownSubtotal).toBe(20.5);
    expect(t.segments[2].fare).toEqual({ status: "unavailable", reason: "no-fare-record" });
  });

  it("gives no total for a trip with no segments", () => {
    expect(calculateTripFare(rules, [], OPTS)).toMatchObject({ total: null, verification: "unavailable", knownSubtotal: 0 });
  });

  it("is unverified, not verified, when a known fare is only a draft", () => {
    const drafts = [rule({ id: "a", routeId: "R1", amount: 12 }), rule({ id: "b", routeId: "R2", amount: 8, status: "unverified" })];
    const t = calculateTripFare(drafts, segs, { ...OPTS, acceptStatuses: ["verified", "unverified"] });
    expect(t).toMatchObject({ total: 20, verification: "unverified" });
  });

  it("does not report a verification date when one fare has none", () => {
    const t = calculateTripFare([rule({ routeId: "R1" }), rule({ id: "n", routeId: "R2", verifiedAt: null })], segs, OPTS);
    expect(t.verifiedAt).toBeNull();
  });

  it("prices one ride through calculateFare", () => {
    const t = calculateFare(rules, { routeId: "R1", boardingStopId: "A", dropoffStopId: "B" }, { category: "regular", date: "2026-06-01" });
    expect(t).toMatchObject({ total: 12, category: "regular", verification: "verified" });
  });

  it("uses the same student rules per segment", () => {
    const both = [...rules, rule({ id: "s1", routeId: "R1", category: "student", amount: 9 })];
    const t = calculateTripFare(both, segs, { category: "student", date: "2026-06-01" });
    expect(t.total).toBeNull();
    expect(t.missing).toEqual([1]);
  });
});
