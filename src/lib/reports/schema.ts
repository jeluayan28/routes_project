import { z } from "zod";

/**
 * A public correction report. This is a CLAIM from a visitor: it is stored for an
 * administrator to look at, and nothing here (or in the database) lets it change a
 * route, stop or fare. The same rules are enforced again by the database, which is
 * what a direct API call meets; this schema gives the form immediate feedback.
 */

export const PUBLIC_REPORT_TYPES = ["incorrect_route", "incorrect_direction", "incorrect_stop", "incorrect_fare", "missing_route", "missing_stop", "other"] as const;
export type PublicReportType = (typeof PUBLIC_REPORT_TYPES)[number];

export const PUBLIC_REPORT_LABEL: Record<PublicReportType, string> = {
  incorrect_route: "The route is wrong",
  incorrect_direction: "A direction is wrong",
  incorrect_stop: "A stop is wrong",
  incorrect_fare: "A fare is wrong",
  missing_route: "A route is missing",
  missing_stop: "A stop is missing",
  other: "Something else",
};

export const DESCRIPTION_MIN = 10;
/** The database allows 2000; the form asks for less so reports stay readable. */
export const DESCRIPTION_MAX = 1000;
export const CONTACT_MAX = 200;
export const MAX_LINKS = 2;

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const CONTACT_CONTROL = /[\u0000-\u001f\u007f]/;

export const reportInputSchema = z
  .object({
    type: z.enum(PUBLIC_REPORT_TYPES, { error: "Choose what is wrong." }),
    routeId: z.uuid().nullable(),
    stopId: z.uuid().nullable(),
    direction: z.enum(["outbound", "inbound"]).nullable(),
    description: z
      .string()
      .transform((v) => v.replace(/[ \t]+/g, " ").trim())
      .pipe(
        z
          .string()
          .min(DESCRIPTION_MIN, `Please describe the problem in at least ${DESCRIPTION_MIN} characters.`)
          .max(DESCRIPTION_MAX, `Please keep it under ${DESCRIPTION_MAX} characters.`)
          .refine((v) => !CONTROL.test(v), "That text contains characters we can't accept.")
          .refine((v) => (v.match(/(https?:\/\/|www\.)/gi) ?? []).length <= MAX_LINKS, `Please include at most ${MAX_LINKS} links.`),
      ),
    contact: z
      .string()
      .trim()
      .max(CONTACT_MAX, `Keep this under ${CONTACT_MAX} characters.`)
      .refine((v) => !CONTACT_CONTROL.test(v), "That text contains characters we can't accept.")
      .transform((v) => (v === "" ? null : v)),
    /** A hidden field real visitors never fill in. Any value is accepted here; submitReport answers it as a success and sends nothing. */
    website: z.string().optional(),
  })
  .superRefine((r, ctx) => {
    const need = (ok: boolean, path: string, message: string) => ok || ctx.addIssue({ code: "custom", path: [path], message });
    need(r.type !== "incorrect_route" || r.routeId !== null, "routeId", "Choose the route.");
    need(r.type !== "incorrect_fare" || r.routeId !== null, "routeId", "Choose the route the fare is for.");
    need(r.type !== "incorrect_direction" || r.routeId !== null, "routeId", "Choose the route.");
    need(r.type !== "incorrect_direction" || r.direction !== null, "direction", "Choose the direction.");
    need(r.type !== "incorrect_stop" || r.stopId !== null, "stopId", "Choose the stop.");
  });

export type ReportInput = z.input<typeof reportInputSchema>;
export type ReportParsed = z.output<typeof reportInputSchema>;
