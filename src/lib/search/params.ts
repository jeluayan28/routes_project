import { z } from "zod";
import { type RawSearchParams, firstParam, parseTypes } from "@/lib/search-params";
import { HARD_MAX_TRANSFERS, PREFERENCES, type Preference } from "@/lib/search/types";
import { fareCategorySchema, type FareCategory } from "@/lib/validation/route";
import type { VehicleType } from "@/lib/validation/transport";

export type TripParams = {
  from: string;
  to: string;
  types: VehicleType[];
  category: FareCategory;
  maxTransfers: number;
  preference: Preference;
};

export const DEFAULT_MAX_TRANSFERS = 2;

const place = z.string().trim().min(1).max(120);

/** Reads /search query parameters. Unknown or out-of-range options fall back to defaults; places must be present. */
export function parseTripParams(raw: RawSearchParams):
  | { status: "empty" }
  | { status: "invalid"; message: string }
  | { status: "ok"; value: TripParams } {
  const from = firstParam(raw.from);
  const to = firstParam(raw.to);
  if (!from?.trim() && !to?.trim()) return { status: "empty" };
  if (!from?.trim()) return { status: "invalid", message: "Enter a starting point." };
  if (!to?.trim()) return { status: "invalid", message: "Enter a destination." };

  const fromParsed = place.safeParse(from);
  const toParsed = place.safeParse(to);
  if (!fromParsed.success || !toParsed.success) return { status: "invalid", message: "Places can be at most 120 characters." };

  const category = fareCategorySchema.safeParse(firstParam(raw.category));
  // Digits only: Number("") and Number(" ") are 0, which would silently mean "no transfers".
  const transfersText = firstParam(raw.transfers)?.trim() ?? "";
  const transfers = /^[0-9]$/.test(transfersText) ? Number(transfersText) : NaN;
  const preference = firstParam(raw.pref) as Preference | undefined;

  return {
    status: "ok",
    value: {
      from: fromParsed.data,
      to: toParsed.data,
      types: parseTypes(firstParam(raw.types)),
      category: category.success ? category.data : "regular",
      maxTransfers: Number.isInteger(transfers) && transfers >= 0 && transfers <= HARD_MAX_TRANSFERS ? transfers : DEFAULT_MAX_TRANSFERS,
      preference: preference && PREFERENCES.includes(preference) ? preference : "fewest-transfers",
    },
  };
}

/** The query string for a search, used by the form and by "pick one" links. */
export function tripQuery(p: TripParams): string {
  return new URLSearchParams({
    from: p.from,
    to: p.to,
    types: p.types.join(","),
    category: p.category,
    transfers: String(p.maxTransfers),
    pref: p.preference,
  }).toString();
}
