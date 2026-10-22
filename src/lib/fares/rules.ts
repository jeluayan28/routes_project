import { pesosToCentavos } from "@/lib/fares/money";
import type { FareRule } from "@/lib/fares/types";
import { fareCategorySchema } from "@/lib/validation/route";

export type RuleProblem =
  | "invalid-route"
  | "invalid-amount"
  | "invalid-currency"
  | "invalid-category"
  | "invalid-date"
  | "invalid-period"
  | "invalid-stops";

export type RuleIssueCode = RuleProblem | "duplicate-rule" | "conflicting-rules";

export type RuleIssue = { rule: FareRule; code: RuleIssueCode; message: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar date in YYYY-MM-DD form. */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

const MESSAGES: Record<RuleProblem, string> = {
  "invalid-route": "The fare is not attached to a route.",
  "invalid-amount": "The amount must be a peso value of zero or more with at most two decimals.",
  "invalid-currency": "Fares must be in Philippine pesos (PHP).",
  "invalid-category": "The passenger category is not recognised.",
  "invalid-date": "A date is not a real calendar date (YYYY-MM-DD).",
  "invalid-period": "The fare ends before it starts.",
  "invalid-stops": "A stop-to-stop fare needs two different stops; a flat fare needs none.",
};

/** The first thing wrong with one rule on its own, or null if it is well formed. */
export function ruleProblem(rule: FareRule): RuleProblem | null {
  if (typeof rule.routeId !== "string" || rule.routeId === "") return "invalid-route";
  if (pesosToCentavos(rule.amount) === null) return "invalid-amount";
  if (rule.currency !== undefined && rule.currency !== "PHP") return "invalid-currency";
  if (!fareCategorySchema.safeParse(rule.category).success) return "invalid-category";
  if (!isIsoDate(rule.effectiveFrom) || (rule.effectiveUntil !== null && !isIsoDate(rule.effectiveUntil))) return "invalid-date";
  if (rule.effectiveUntil !== null && rule.effectiveUntil < rule.effectiveFrom) return "invalid-period";
  if ((rule.fromStopId === null) !== (rule.toStopId === null)) return "invalid-stops";
  if (rule.fromStopId !== null && rule.fromStopId === rule.toStopId) return "invalid-stops";
  return null;
}

export const describeProblem = (code: RuleProblem) => MESSAGES[code];

/** Whether the rule is in force on `date`. Only meaningful for a well-formed rule. */
export const inForce = (rule: FareRule, date: string) => rule.effectiveFrom <= date && (rule.effectiveUntil === null || rule.effectiveUntil >= date);

/** Whether two well-formed rules share a price slot (route, stops, category) at the same time. */
export function collides(a: FareRule, b: FareRule): boolean {
  return (
    a.routeId === b.routeId &&
    a.fromStopId === b.fromStopId &&
    a.toStopId === b.toStopId &&
    a.category === b.category &&
    a.effectiveFrom <= (b.effectiveUntil ?? "9999-12-31") &&
    b.effectiveFrom <= (a.effectiveUntil ?? "9999-12-31")
  );
}

/**
 * Checks a set of stored rules and says which cannot be used and why.
 *
 *  - A malformed rule (bad amount, dates, stops, ...) is rejected.
 *  - Two rules for the same route, stops and category whose periods overlap and
 *    which give the same price are duplicates: the first is kept, the rest are
 *    rejected.
 *  - If the prices differ they conflict, and every rule involved is rejected.
 *    There is no safe way to choose between them.
 *
 * The database forbids overlap, so this is a second line of defence for data
 * that arrives some other way (an import, a manual edit, a bug).
 */
export function auditFareRules(rules: readonly FareRule[]): { valid: FareRule[]; issues: RuleIssue[] } {
  const issues: RuleIssue[] = [];
  const wellFormed: FareRule[] = [];
  for (const rule of rules) {
    const problem = ruleProblem(rule);
    if (problem) issues.push({ rule, code: problem, message: MESSAGES[problem] });
    else wellFormed.push(rule);
  }

  const rejected = new Set<FareRule>();
  for (let i = 0; i < wellFormed.length; i++) {
    for (let j = i + 1; j < wellFormed.length; j++) {
      const a = wellFormed[i];
      const b = wellFormed[j];
      if (!collides(a, b)) continue;
      if (pesosToCentavos(a.amount) === pesosToCentavos(b.amount)) {
        if (!rejected.has(a) && !rejected.has(b)) {
          rejected.add(b);
          issues.push({ rule: b, code: "duplicate-rule", message: "Another rule already gives this price for the same route, stops, category and dates." });
        }
      } else {
        for (const rule of [a, b]) {
          if (!rejected.has(rule)) issues.push({ rule, code: "conflicting-rules", message: "Another rule gives a different price for the same route, stops, category and dates." });
          rejected.add(rule);
        }
      }
    }
  }
  return { valid: wellFormed.filter((r) => !rejected.has(r)), issues };
}
