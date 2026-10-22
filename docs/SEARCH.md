# Route search engine

Finds journeys between two places using **approved data only**: active and verified routes, their verified stop sequences,
verified fares, and the boarding/drop-off rules recorded for each stop. It is in `src/lib/search/`; the engine itself
(`engine.ts`, `network.ts`, `fares.ts`, `geometry.ts`, `rank.ts`, `types.ts`) is pure and typed: no I/O, no clock, no
randomness. Everything around it (loading data, resolving places, the page) is separate.

```
URL ──▶ params.ts ──▶ service.ts ──▶ load.ts (database, approved rows only)
                          │
                          ├─▶ locations.ts (+ geocoder.ts)   resolve origin and destination
                          └─▶ network.ts ─▶ engine.ts ─▶ rank.ts   build graph, search, rank
                                      results ──▶ /search page, TripResults, TripMap
```

**No Butuan routes, stops or fares are built in.** The tests use an invented grid (`__fixtures__/fictional.ts`, near 0.1°, 0.1°,
open sea). With no verified data, the search honestly says no journey was found.

## What a search takes

| Input | Notes |
|---|---|
| Origin, destination | A verified stop name, a landmark name, `stop:<id>` / `landmark:<id>`, coordinates (`@lat,lng` or `lat, lng`), or, if enabled, a geocoder result. |
| Transport types | Optional. Filters every leg. |
| Passenger category | `regular`, `student`, `senior`, `pwd`. Selects the fare. |
| Maximum transfers | 0 to 4 (default 2). 4 is a hard cap. |
| Preference | `fewest-transfers` (default), `lowest-fare`, `shortest-walking`. |

Defaults (all configurable through `SearchOptions`, see `DEFAULT_SEARCH_OPTIONS`): walk to the first stop / from the last stop
at most **500 m**; walk between stops when transferring at most **200 m**; walking distance = straight-line distance × **1.3**; up to
8 candidate stops per end; 5 results.

## Step 1: Location resolution (`locations.ts`)

In order: a `stop:`/`landmark:` link; coordinates; a name matched against verified stops and landmarks (exact, then partial: every
typed word must start a word of the name); and only if nothing matches, the geocoder.

* Several equally good matches are returned as a **choice** for the user. Nothing is picked silently. A stop and a landmark of the same
  name within 100 m count as one place (the stop).
* A single partial match is used but flagged `approximate` and shown ("We read your entry as …").
* Unverified or outdated stops are never matched by name. Sample data only when the search is explicitly in sample mode.
* Coordinates are checked for range, 0,0, and the Butuan service area (`BUTUAN_SERVICE_AREA`, a sanity box in `constants.ts`).
* The geocoder (`geocoder.ts`) is optional (`GEOCODER_PROVIDER=nominatim` plus `GEOCODER_CONTACT`). It is bounded to the service area,
  cached, limited to one request per second, sends an identifying User-Agent, times out, and is only called when someone submits a
  search (no autocomplete), following the Nominatim usage policy. Its results are guesses about where a name is: never verified data.
  If it fails, the search reports "place search unavailable" instead of failing.

### Nearby stops

A place that is not a stop is connected to the network through **candidate stops**: usable stops within the walking threshold,
nearest first, where a passenger could really board (origin side) or get off (destination side). If there are none, the failure
says how far the nearest one is.

**Distance is not a route.** Walking distance is a straight-line estimate scaled by a circuity factor. Being close does not mean a
safe walkable path exists (Butuan has rivers, highways and fences). Every walking step is therefore labelled an estimate; the engine
never claims a walk is possible, only that the straight-line distance is within the limit.

## Step 2: The network (`network.ts`)

* **Nodes**: each usable stop (verified, real coordinates, not 0,0) that some route direction uses.
* **Edges**: for each route direction, a directed edge between each pair of **consecutive** stops. An edge records route id,
  transport type, boarding stop, drop-off stop, the two sequence positions, whether boarding is allowed at the first and drop-off at
  the second, the fare availability (`flat`, `by-stop-pair`, `none`) and the verification status.
* **Lines**: each direction as an ordered chain. Outbound and inbound are separate lines with their own stops, never one reversed.
* **Boarding/drop-off**: the route's own setting, else the stop's. A vehicle can pass through a stop where nobody may board; the
  last stop of a direction is never a place to board and the first is never a place to get off.
* **Excluded**, and counted in diagnostics: routes not in an accepted status; a direction with a missing or unusable stop, a gap in
  its positions, or fewer than two stops. A route is never "repaired".
* **Duplicates**: directions identical in transport type, stops, permissions **and applicable fares** are folded into one; the
  others are listed as "same stops and fare". If the fares differ, both are kept: the choice matters.

## Steps 3 and 4: Finding journeys (`engine.ts`)

1. Candidate stops are found for both ends.
2. **Patterns** are enumerated: ordered sequences of route directions in which each next route can be boarded after getting off the
   previous one (same stop, a verified walking link, or a stop within the transfer walking limit). A route is never used twice, so loops
   in the network cannot cause cycles. Branches that cannot reach the destination within the transfer limit are pruned.
3. For each pattern a **dynamic program** picks the best boarding, transfer and alighting stops for the chosen preference, honouring
   direction, stop order and permissions. The cost is a lexicographic vector of integers (metres, missing fares, centavos, stops), so
   sums are exact.
4. A result that visits a stop twice is discarded.
5. If nothing is found within the limit, the search is repeated with more transfers (up to the cap) only to tell the user "a journey
   exists with N transfers".

Transfer rules: the same stop; or a verified link from `transferLinks` (none exist in the database yet); or two stops whose estimated
walk is within the limit. Nothing else.

## Fares (`fares.ts`)

The rules below live in the fare calculator (`src/lib/fares/`, see `docs/FARES.md`); `fares.ts` adapts it for the engine. Records that are
malformed or that conflict with each other are rejected, and the reason is reported.

Only fares in an accepted status (production: **verified**) and in force on the search date (Asia/Manila) count. A rule for the exact
origin and destination wins over a flat route fare. Direction matters (A→B does not price B→A). **The category is never substituted**:
with no student fare, the regular fare is not shown as the student fare. An unverified fare is never used, only given as the reason
(`fare-not-verified`).

A journey whose fare is missing is still returned (every route, stop and permission in it is verified), with an explicit
"unavailable" fare per segment and **no total**. A total exists only when every ridden segment has a known fare; otherwise only a
subtotal of the known segments is given.

## Ranking (`rank.ts`)

Several journeys are returned when they exist (one per set of routes). Redundant ones are dropped: a result that uses only some of
another's routes' superset and is no worse on transfers, walking and fare makes the larger one redundant ("take A, then B" when B
alone does it).

| Preference | Order |
|---|---|
| Fewest transfers | transfers, walking, fare known, fare, stops travelled |
| Lowest fare | fare known (a journey with an unknown fare always ranks after one with a known fare), missing segments, known fare, transfers, walking |
| Shortest walking | walking, transfers, fare known, fare, stops travelled |

Ties break on the journey id, so output is deterministic.

**Travel time is not estimated and there is no "fastest" option.** There is no timing data, speed data or schedule in the
database, and inventing minutes from distance would be a guess presented as fact. Every journey carries
`travelTime: { available: false, reason: "no-timing-data" }`. No real-time arrivals are claimed.

## Results

Each journey has ordered steps: `walk` (access, transfer, egress) and `ride`. A ride has the route name, code, transport type,
direction ("toward the last stop"), boarding and drop-off stops, intermediate stops, the segment fare, an instruction sentence, and
**map geometry for that segment**: the part of the route's *recorded* line between the two stops. If the route has no recorded line, a
stop is more than 75 m from it, or the stops do not fall in travel order along it, the geometry is `unavailable` with the reason and
nothing is drawn. Walking is not drawn. Also: fare summary (total only if complete), transfers, walking metres, data status
(`verified` or `sample`), whether walking is an estimate, the oldest verification date used, and notes (including a warning when
verification is more than 180 days old).

## Failure states

| State | When |
|---|---|
| `error` | The database request failed (or is not configured). No search runs and sample data is never substituted. |
| `location-problem` | Not found, invalid, outside the service area, or place search unavailable, with a message per end. |
| `needs-choice` | A name matches several places. |
| `no-journey` / `no-usable-routes` | No approved routes at all. |
| `only-unverified-routes` | Routes exist but none is verified (or only sample data in production). |
| `no-routes-for-filters` | The transport filter leaves nothing. |
| `no-boarding-stop-near-origin`, `no-alighting-stop-near-destination` | No usable stop within walking range; the nearest is named. |
| `origin-equals-destination` | Same place, or within 50 m. |
| `transfer-limit` | A journey exists but needs more transfers than allowed (with the number needed). |
| `no-route` | No verified route connects the places, even at the cap. |

"No journey" means no **verified** journey. A real service may exist that has not been added yet, and the page says so.

## Assumptions and limitations

* **Straight-line walking**: estimates only; no pedestrian network, no barriers, no accessibility information. Transfers to a different
  stop depend on that estimate unless a verified link is supplied.
* **No timing**: no travel times, waits, schedules, operating hours or real-time data.
* **Routes are fixed lines**: one pattern per direction. No short-turns, skipped stops, loop routes that revisit a stop (the database
  does not allow a stop twice in a direction), or time-of-day variants.
* **Fares are per ride, summed**: no zone or distance formula, no discounts beyond recorded category fares, no transfer discounts, no
  assumption that A→B and B→A cost the same.
* **One result per set of routes**: the best stops for that set under your preference, not every stop combination.
* **Search is exhaustive only up to its caps**: 4 transfers, 5,000 route combinations (a note says when it was cut short).
* **Loaded per request**: the whole approved network is read from the database on every search. That is fine for a city's worth of
  routes. Cache it (with a short lifetime, because an administrator un-verifying a route must take effect quickly) or move the
  nearby-stop lookup into PostGIS if volume grows.
* **Stops are matched by name in memory**: fine for hundreds or a few thousand stops.
* The geocoder is optional and a guess; a geocoded place is never presented as verified.

## Tests

`npm test` covers (in `src/lib/search/`): direct, reverse-direction, one-way and inbound-only journeys; incorrect stop order; disallowed
boarding and drop-off (including on transfers); missing, unverified, outdated, wrong-category and out-of-date fares; fare totals;
transfers at the same stop, near stops, verified links and over-long walks; the transfer limit and its hard cap; cycles and
loops; duplicate and near-duplicate routes; no-route and every failure state; ranking by each preference; per-segment geometry;
sample data handling; place resolution; the geocoder (policy headers, throttle, cache, timeout, failures); URL parameters; database
row assembly; and the service with injected failures. `engine.property.test.ts` runs 150+ seeded random networks, checking on every
journey that direction, order, permissions, walking limits, fares and uniqueness hold, and compares against an independent brute
force for journeys with up to one transfer.
