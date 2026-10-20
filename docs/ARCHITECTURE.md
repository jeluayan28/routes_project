# Butuan Route Finder: Architecture Proposal

Status: **proposal for review.** Only the foundation (Phase 0) is implemented.

## Data integrity rules

- No route, stop, terminal, fare, or schedule is invented. The repo ships with zero transport records.
- Every transport record has `verification_status` (`verified | unverified | sample`). The UI renders it via `VerificationBadge`. Fare estimates use `verified` fares only; otherwise the UI says no verified fare exists.
- Sample data (if ever used for development) lives only in a separate seed file, is marked `sample`, and is never loaded automatically.

## Folder structure

```
src/
  app/                    # routes: / , /search, /routes/[id], /report, /admin/*
  components/
    ui/                   # shadcn primitives
    layout/ common/       # header, footer, VerificationBadge, status panels
    map/                  # BaseMap, RouteLayer, StopMarkers (client-only, Leaflet)
    search/               # trip search form, place picker
    routes/               # route cards, results list, route detail
    fares/                # fare breakdown display
    reports/              # correction/outdated-info form
    admin/                # route/stop/fare/geometry editors
  lib/
    supabase/             # client.ts (browser), server.ts (cookie session)
    data/                 # typed queries (routes, stops, fares); only place that talks to Supabase
    validation/           # Zod schemas shared by forms, API, admin
    routing/              # pure functions: direct-trip matching, later transfers
    fares/                # pure functions: fare calculation from verified fare rules
  types/
supabase/migrations/      # SQL migrations (Phase 1)
docs/
```

Pure logic (`routing/`, `fares/`) takes plain data and returns plain data, so it is unit-testable without a database or map.

## Dependencies

Installed: next, react, typescript, tailwindcss v4, shadcn (base-ui), lucide-react, `@supabase/supabase-js`, `@supabase/ssr`, zod, leaflet, react-leaflet, clsx, tailwind-merge, vitest.
Deferred until needed: react-hook-form (forms phase), a geometry helper such as `@turf/*` (only the modules used), PostGIS on the database side.

## Database architecture (Supabase Postgres)

| Table | Purpose |
|---|---|
| `places` | Named locations users can pick (landmarks, barangays). `lat/lng`, optional PostGIS `geography(Point)` |
| `stops` | Boarding/drop-off points. `place_id?`, location, `verification_status`, `source_note` |
| `routes` | `name`, `vehicle_type` (jeepney/multicab), `geometry` (LineString), `verification_status`, `active` |
| `route_stops` | Ordered stops per route and direction: `route_id, stop_id, direction, sequence`; unique `(route_id, direction, sequence)` |
| `fare_rules` | `route_id`, optional `from_stop_id/to_stop_id`, `fare_type` (flat/distance/segment), amounts, passenger category (regular/student/senior/PWD), `effective_from/to`, `verification_status`, `source_note` |
| `reports` | Public correction submissions: target type/id, message, contact (optional), `status` (new/reviewed/resolved/rejected) |
| `admin_profiles` | `user_id → auth.users`, role |
| `transfers` (later) | Stop-to-stop walking/transfer links for multi-route trips |

Row Level Security (all tables enabled):
- Public (`anon`): `SELECT` on places/stops/routes/route_stops/fare_rules. `INSERT` only on `reports`, with length limits and a rate-limit strategy. No read access to `reports`.
- Admins (authenticated and present in `admin_profiles`): full write on transport tables and read/update on `reports`. Checked via a `security definer` helper `is_admin()`.
- The service-role key is not used by the app.

## Phases

0. **Foundation** (done): scaffold, Supabase clients, env validation, base map, home page, verification badge.
1. **Database**: migrations, RLS, RLS tests, TypeScript types generated from the schema.
2. **Admin**: Supabase Auth login, `proxy.ts` session refresh, CRUD for stops/routes/route_stops/fares, geometry editing.
3. **Public browse**: route list, route detail page with map and ordered stops, verified-fare display.
4. **Trip search**: origin/destination picker, direct-trip matching, fare estimate.
5. **Reports**: public correction form and admin triage.
6. **Transfers**: multi-route journeys via `transfers` table.
7. **Hardening**: accessibility audit, error monitoring, rate limits, Vercel deploy.

## Risks

- **Data availability:** The main risk. Butuan routes and fares must come from field verification or official sources (e.g., city/LTFRB records). Without them the app is an empty shell. Plan a data-collection workflow before Phase 3.
- **Informal routes:** Jeepney and multicab routes are often loosely defined, with flexible stops and fares that change. The model needs `effective_from/to` and "verified on" dates.
- **Public report abuse:** Anonymous inserts need validation, size limits, and rate limiting (and possibly Turnstile or similar).
- **OSM tile policy:** The public tile server is for light use only. Plan a tile provider switch before meaningful traffic.
- **Leaflet and SSR:** Leaflet needs `window`, so maps are client-only via `next/dynamic` with `ssr: false`.
- **Geometry editing UX:** Drawing and editing LineStrings in admin is the heaviest UI piece. Consider GeoJSON paste/upload first.
- **Transfer routing:** Needs a stop graph and accurate walking links. Correct only after direct trips are solid.
- **Tooling:** Next.js 16 (this scaffold ships agent docs in `node_modules/next/dist/docs/` and differs from older versions). Node 22.8 is below what some tools expect (see report).
