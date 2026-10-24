# Interactive map

`RouteMap` (`src/components/map/route-map.tsx`) is a client-only Leaflet map built
with React Leaflet. Pages import `RouteMapLazy`, which loads it with
`next/dynamic({ ssr: false })` so Leaflet never runs on the server.

## Data flow

```
Supabase ──▶ lib/data/routes.ts (getRoutes) ──▶ lib/data/route-mapper.ts ──▶ Route[] ──▶ pages ──▶ RouteMap
```

* `getRoutes()` requests only `status = 'active'` **and** `verification_status = 'verified'`
  routes (RLS enforces the same rule), with their ordered stops and the
  `route_shapes_geojson` view.
* Any failure (missing config, request error, thrown exception) returns
  `{ status: "error" }`. **Fixtures are never used as a fallback.** Pages show an
  error, and `RouteMap` accepts an `error` prop that draws no routes at all.
* An empty result is a normal state ("No routes have been published yet"), not an error.
* Fares are not mapped yet: `Route.fares` is `[]` for database routes.

## Route model

A `Route` has `directions[]`; each direction (`outbound`, `inbound`) has its **own**
ordered stops and its **own** geometry (`paths`, one or more lines). A route
with no `inbound` rows is one-way. Nothing assumes a route is bidirectional or that
the return trip reverses the outbound one.

Geometry is drawn exactly as stored. A direction with no (or malformed) shape
draws **no line**; lines are never inferred from stops. The UI says so.

## Behaviour

| Feature | Where |
|---|---|
| Initial view (configurable `center`, `zoom`; default Butuan City) | `RouteMap` props, `lib/constants.ts` |
| Coloured polylines, stable colour per route | `route-lines.tsx`, `lib/routes/colors.ts` |
| Selected route highlighted; active direction solid, other dashed | `route-lines.tsx` |
| Overlapping routes: clicking a shared road asks which route | `route-lines.tsx`, `routesNearPoint` |
| Stop markers (keyboard-focusable) with popup: name, routes, boarding/drop-off, verification status | `stop-markers.tsx` |
| Zoom, return to Butuan view, fit selected route, clear selection | `map-controls.tsx` |
| Minibus / Multicab filter and route picker (synced with the list) | `map-toolbar.tsx`, `explore-view.tsx` |
| Loading, empty, error, tile-failure states | `map-status.tsx` |
| Fit on selection; re-fit on container resize | `route-map.tsx` |

Selection state lives in `ExploreView` (`select()`), so list, dropdown, map lines and
popups always agree. The map only re-frames when the *selection* changes (or the
container is resized), never because the filtered list changed.

Stop clustering is **not** implemented: the number of stops is small. Add it (e.g.
`react-leaflet-cluster`) if the published stop count reaches the hundreds.

## Tiles and attribution

The default is OpenStreetMap's public tile server with the required attribution.
That server is run by volunteers; its
[usage policy](https://operations.osmfoundation.org/policies/tiles/) allows light
use but not heavy production traffic, bulk downloads or scraping. The app does
none of those (no prefetching, no retina doubling, no offline caching).

For production traffic, choose a provider whose terms fit the load (a commercial
OSM-based tile service or your own tile server) and set **both**:

```
NEXT_PUBLIC_MAP_TILE_URL=https://tiles.example.com/{z}/{x}/{y}.png
NEXT_PUBLIC_MAP_TILE_ATTRIBUTION=&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, ...
```

A custom URL without attribution (or not https / missing `{z}{x}{y}`) is ignored.
No Google Maps APIs are used. OSM does not contain Butuan's minibus/multicab
routes; all transport data comes from the database.

## Development fixtures

`src/dev-fixtures/sample-routes.ts` holds clearly labelled **sample** routes (two
directions with different geometry, a one-way route overlapping another, a
MultiLineString, a stops-only route). They load only when
`NEXT_PUBLIC_ENABLE_SAMPLE_DATA=true` and are imported lazily by the data layer
and by tests; no other code imports them. The UI shows a "Development data" banner
and a "Sample data" badge.

## Tests

`npm test`. Logic tests run in Node. Component tests run Leaflet in jsdom
(`// @vitest-environment jsdom`; `src/test/setup.ts` stubs layout and
`ResizeObserver`). They cover route selection and list/map/dropdown sync, marker
popups, type filtering, empty data, failed requests, directions, overlapping
routes, bounds fitting and resize handling.

jsdom has no layout, so true mobile rendering is checked by hand: open
`/explore` at about 390 px wide. The map takes the top of the screen and the route
panel sits below it (collapsible); map buttons are 44 px touch targets.
Outside the full-screen explore page, one-finger drag and wheel zoom are off so the
map does not trap page scrolling (`captureGestures`).
