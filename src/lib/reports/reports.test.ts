import { describe, expect, it, vi } from "vitest";
import { reportInputSchema, type ReportInput } from "@/lib/reports/schema";
import { describeSubmitError, submitReport } from "@/lib/reports/submit";

const ID = "11111111-1111-4111-8111-111111111111";
const valid = (over: Partial<ReportInput> = {}): ReportInput => ({
  type: "incorrect_fare", routeId: ID, stopId: null, direction: null, description: "The regular fare is now 15 pesos.", contact: "", ...over,
});
const client = (error: { code?: string; message?: string } | null = null) => {
  const insert = vi.fn().mockResolvedValue({ error });
  return { insert, db: { from: vi.fn(() => ({ insert })) } as never };
};

describe("report input schema", () => {
  it("accepts a valid report and treats a blank contact as none", () => {
    expect(reportInputSchema.parse(valid()).contact).toBeNull();
  });

  it("tidies whitespace", () => {
    expect(reportInputSchema.parse(valid({ description: "   Wrong   \t fare    here   " })).description).toBe("Wrong fare here");
  });

  it("rejects text that is too short, too long, or has control characters", () => {
    for (const description of ["short", "x".repeat(1001), "bad\u0000text here", "bell\u0007 character"]) {
      expect(reportInputSchema.safeParse(valid({ description })).success).toBe(false);
    }
  });

  it("allows two links but not link-stuffed spam", () => {
    expect(reportInputSchema.safeParse(valid({ description: "See https://a.example and https://b.example for the fare." })).success).toBe(true);
    expect(reportInputSchema.safeParse(valid({ description: "https://a.example https://b.example www.c.example buy now" })).success).toBe(false);
  });

  it("rejects malformed ids and an oversized contact", () => {
    expect(reportInputSchema.safeParse(valid({ routeId: "not-a-uuid" })).success).toBe(false);
    expect(reportInputSchema.safeParse(valid({ contact: "x".repeat(201) })).success).toBe(false);
  });

  it("requires each kind of report to name its subject", () => {
    expect(reportInputSchema.safeParse(valid({ type: "incorrect_route", routeId: null })).success).toBe(false);
    expect(reportInputSchema.safeParse(valid({ type: "incorrect_fare", routeId: null })).success).toBe(false);
    expect(reportInputSchema.safeParse(valid({ type: "incorrect_stop", routeId: null, stopId: null })).success).toBe(false);
    expect(reportInputSchema.safeParse(valid({ type: "incorrect_stop", routeId: null, stopId: ID })).success).toBe(true);
    expect(reportInputSchema.safeParse(valid({ type: "incorrect_direction", direction: null })).success).toBe(false);
    expect(reportInputSchema.safeParse(valid({ type: "incorrect_direction", direction: "inbound" })).success).toBe(true);
    expect(reportInputSchema.safeParse(valid({ type: "other", routeId: null })).success).toBe(true);
  });
});

describe("submitReport", () => {
  it("inserts only the report's content columns", async () => {
    const c = client();
    expect(await submitReport(c.db, valid({ contact: "me@example.com" }))).toEqual({ ok: true });
    expect(c.insert).toHaveBeenCalledWith({
      report_type: "incorrect_fare", route_id: ID, stop_id: null, direction: null,
      description: "The regular fare is now 15 pesos.", reporter_contact: "me@example.com",
    });
  });

  it("does not call the database for invalid input", async () => {
    const c = client();
    expect(await submitReport(c.db, valid({ description: "x" }))).toMatchObject({ ok: false, kind: "invalid" });
    expect(c.insert).not.toHaveBeenCalled();
  });

  it("answers a filled honeypot as success without sending anything", async () => {
    const c = client();
    expect(await submitReport(c.db, valid({ website: "http://spam.example" }))).toEqual({ ok: true });
    expect(c.insert).not.toHaveBeenCalled();
  });

  it("maps database failures to messages that never echo SQL", () => {
    expect(describeSubmitError({ message: "Too many reports from this connection" }).kind).toBe("rate-limited");
    expect(describeSubmitError({ code: "42501", message: "new row violates row-level security policy for table route_reports" }).kind).toBe("not-found");
    expect(describeSubmitError({ code: "23514", message: "violates check constraint" }).kind).toBe("rejected");
    const other = describeSubmitError({ code: "XX000", message: "relation secret_table does not exist" });
    expect(other.kind).toBe("unavailable");
    expect(other.message).not.toContain("secret_table");
  });

  it("survives the client throwing", async () => {
    const db = { from: () => { throw new Error("network down"); } } as never;
    expect(await submitReport(db, valid())).toMatchObject({ ok: false, kind: "unavailable" });
  });
});
