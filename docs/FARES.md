# Fares

How a fare is calculated, stored, changed and shown. **No real Butuan fare is built into this repository.** Every price must be
entered by an administrator from a real source; until then the app says "unavailable" rather than guess.

## Calculator (`src/lib/fares/`)

Pure functions: no I/O, no clock, no randomness.

| File | What it does |
|---|---|
| `calculator.ts` | `calculateFare` (one ride), `calculateTripFare` (several segments), `calculateSegmentFare`, `createFareBook` (many lookups), `assembleTripFare`, `summarizeLegFares` |
| `rules.ts` | `ruleProblem` (is one rule well formed), `auditFareRules` (which rules in a set can be used and why not), `collides` |
| `money.ts` | Integer centavos: `pesosToCentavos` (rejects negative, non-finite, more than 2 decimals, out of range) |
| `types.ts` | `FareRule`, `LegFare`, `TripFare`, `FareOptions` |

Input: the route, boarding stop, drop-off stop, passenger category, a date (Asia/Manila calendar date) and the stored rules.

A segment's fare is chosen like this, and anything that fails is reported as the **reason** the fare is unavailable:

1. Only rules for that route and for that exact stop pair, or a flat whole-route rule, are considered (`no-fare-record`).
2. Only rules **in force** on the date (`fare-not-in-force` for expired or not-yet-started).
3. Only rules in an accepted status. Production accepts **verified** only (`fare-not-verified`). Callers may opt in to
   `unverified` (an administrator preview); such a fare is labelled **unverified**.
4. Only the requested passenger category. **It is never substituted**: a regular fare is never shown as a student fare
   (`no-fare-for-category`).
5. A rule for the exact stops wins over a flat fare. If a rule for the exact stops exists but is unusable, the flat fare is
   **not** used in its place. Direction matters: A to B does not price B to A.
6. Malformed rules (negative or non-finite amount, more than two decimals, a currency other than PHP, impossible dates,
   end before start, one stop or the same stop twice) are rejected (`invalid-fare-record`).
7. Overlapping rules for the same slot: identical prices are duplicates and collapse to one; different prices are a
   **conflict** and every rule involved is rejected (`conflicting-fare-rules`). A verified rule outranks a draft.

There is **no default fare and no distance formula**. A distance-based formula may only be added once an official fare table
has been verified and encoded, and it would go in this module.

### Trips and transfers

Each segment (one route, one boarding stop, one drop-off stop) is priced on its own. The trip **total exists only if every
segment has a known fare** (`total: null` otherwise); the known segments are reported as `knownSubtotal`, which the UI
labels as not a total. The trip is **verified** only if every segment's fare is verified, **unverified** if all are known but
some are drafts, and **unavailable** otherwise. The oldest verification time and the recorded sources are carried through.

The search engine (`src/lib/search/fares.ts`) uses this same code, so a search and the calculator cannot disagree.

## Storage

`public.fare_rules.amount` is `numeric(8,2)`: fixed precision, never floating point; `currency` is fixed to `PHP`. Sums are done
in integer centavos. Each rule has a passenger category, optional stop pair, `effective_from` / `effective_until`,
`source_description` and `verified_at`. The database refuses overlapping periods for the same route, stops and category,
and stops that are not on the route.

## Changing a price (history is kept)

A verified fare is a record of what was charged, so it is never overwritten or deleted through the API:

* **Change price** (`public.change_fare`): ends the old rule the day before the new date and adds a **new, unverified** rule
  from that date. The new price is hidden from the public until the route is verified again.
* **End fare** (`public.end_fare`): sets the last day a fare applies. It keeps its verification.
* Editing or deleting a verified fare directly is refused by the database. Unverified drafts can still be edited or deleted.
* Re-verifying a route does not re-stamp fares that were already verified, so each keeps the date it was actually verified.

Both are administrator-only (checked in the function, and again by row-level security). Every change is in the audit log with
the old values. A fare entered wrongly *from its start date* cannot be corrected in place once verified: end it and add the right
one from the next day (or ask the project owner to fix it in the SQL editor).

## Display

The trip result shows the total prominently, a per-segment breakdown, the passenger category ("Regular fare" / "Student fare"),
a **Verified / Unverified / Unavailable** label, each fare's verification date and source, the dates it is in force, why a fare
is unavailable, and a "Report incorrect information" link. Amounts are formatted by one function (`formatPeso`): `₱12.00`,
`₱1,234.50`.

## Fare rules that still need configuring

The database ships with **no fare rules**. For every route that should show a price, an administrator must add, from a real
source, and then verify the route:

* a **regular** fare, flat or per boarding/drop-off pair, with an effective date;
* a **student** fare (and **senior citizen** / **PWD** fares if they are to be shown), if one applies;
* the source of each, and the date it was checked.

Until then every journey shows its fare as unavailable with the reason. The sample rows in `src/dev-fixtures/` are fictional
and must never be imported into production.
